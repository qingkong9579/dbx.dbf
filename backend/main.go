// DBF Studio 原生 Sidecar。
//
// 职责很窄：作为 DBF 连接类型的后端，校验本地 .DBF 文件/目录、按块读取数据，
// 并在用户允许时把编辑结果原子写回磁盘（先备份 .bak 再替换）。
// 协议为 DBX Sidecar Protocol v1（stdio-jsonl），初始化由 dbxpluginsdk 处理。
package main

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	dbx "github.com/dbx/dbf-studio/backend/dbxpluginsdk"
)

const (
	pluginID      = "com.dbx.dbf"
	pluginVersion = "0.3.1"

	maxReadChunk = 1024 * 1024 // 单次 dbf/read 上限
	maxWriteByte = 1024 * 1024 // 单次 dbf/write-chunk 上限
)

var dbxVersions = map[byte]bool{
	0x02: true, 0x03: true, 0x04: true, 0x05: true, 0x07: true,
	0x30: true, 0x31: true, 0x32: true, 0x43: true, 0x63: true,
	0x7B: true, 0x83: true, 0x8B: true, 0xCB: true, 0xE5: true,
	0xF5: true, 0xFB: true,
}

var memoExts = map[string]bool{".dbt": true, ".fpt": true}

/* ------------------------------------------------------------------ types */

type config struct {
	Source     string `json:"source"`
	File       string `json:"file"`
	Folder     string `json:"folder"`
	Encoding   string `json:"encoding"`
	AllowWrite bool   `json:"allow_write"`
}

type tableInfo struct {
	Name     string `json:"name"`
	Size     int64  `json:"size"`
	Records  uint32 `json:"records"`
	Fields   int    `json:"fields"`
	Version  string `json:"version"`
	Modified string `json:"modified"`
	Memo     string `json:"memo,omitempty"`
}

type writeSession struct {
	file    *os.File
	tmp     string
	target  string
	written int64
}

type plugin struct {
	mu      sync.Mutex
	conns   map[string]config
	writes  map[string]*writeSession
	seq     int
	dataDir string
}

func newPlugin() *plugin {
	p := &plugin{
		conns:   map[string]config{},
		writes:  map[string]*writeSession{},
		dataDir: os.Getenv("DBX_PLUGIN_DATA_DIR"),
	}
	p.loadConfigs()
	return p
}

/* ------------------------------------------------------- config persistence */

func (p *plugin) configPath() string {
	if p.dataDir == "" {
		return ""
	}
	return filepath.Join(p.dataDir, "connections.json")
}

func (p *plugin) loadConfigs() {
	path := p.configPath()
	if path == "" {
		return
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var stored map[string]config
	if json.Unmarshal(raw, &stored) != nil {
		return
	}
	p.conns = stored
}

// saveConfigs 持有 p.mu 调用。
func (p *plugin) saveConfigs() {
	path := p.configPath()
	if path == "" {
		return
	}
	if err := os.MkdirAll(p.dataDir, 0o700); err != nil {
		return
	}
	raw, err := json.MarshalIndent(p.conns, "", "  ")
	if err != nil {
		return
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
	}
}

/* ---------------------------------------------------------- lifecycle input */

type lifecycle struct {
	Provider struct {
		ID           string `json:"id"`
		DatabaseType string `json:"database_type"`
	} `json:"provider"`
	Connection struct {
		ID             string                     `json:"id"`
		Name           string                     `json:"name"`
		ReadOnly       bool                       `json:"read_only"`
		ExternalConfig map[string]json.RawMessage `json:"external_config"`
		Secrets        map[string]string          `json:"connection_secrets"`
	} `json:"connection"`
}

func (l lifecycle) config() config {
	cfg := config{Source: "file", Encoding: "auto", AllowWrite: true}
	get := func(key string) string {
		raw, ok := l.Connection.ExternalConfig[key]
		if !ok {
			return ""
		}
		var text string
		if json.Unmarshal(raw, &text) == nil {
			return text
		}
		return ""
	}
	if v := strings.TrimSpace(get("source")); v == "folder" || v == "file" {
		cfg.Source = v
	}
	cfg.File = strings.TrimSpace(get("file"))
	cfg.Folder = strings.TrimSpace(get("folder"))
	if v := strings.TrimSpace(get("encoding")); v != "" {
		cfg.Encoding = v
	}
	if raw, ok := l.Connection.ExternalConfig["allow_write"]; ok {
		var flag bool
		if json.Unmarshal(raw, &flag) == nil {
			cfg.AllowWrite = flag
		}
	}
	if l.Connection.ReadOnly {
		cfg.AllowWrite = false
	}
	return cfg
}

/* ------------------------------------------------------------ path helpers */

func (c config) memoFor(path string) string {
	stem := strings.TrimSuffix(path, filepath.Ext(path))
	for ext := range memoExts {
		for _, candidate := range []string{stem + ext, stem + strings.ToUpper(ext)} {
			if info, err := os.Stat(candidate); err == nil && info.Mode().IsRegular() {
				return filepath.Base(candidate)
			}
		}
	}
	return ""
}

func dirOf(c config) (string, error) {
	switch c.Source {
	case "folder":
		if c.Folder == "" {
			return "", errors.New("未配置数据目录")
		}
		info, err := os.Stat(c.Folder)
		if err != nil || !info.IsDir() {
			return "", fmt.Errorf("目录不可用：%s", c.Folder)
		}
		return c.Folder, nil
	default:
		if c.File == "" {
			return "", errors.New("未配置 DBF 文件")
		}
		info, err := os.Stat(c.File)
		if err != nil || !info.Mode().IsRegular() {
			return "", fmt.Errorf("文件不可用：%s", c.File)
		}
		return filepath.Dir(c.File), nil
	}
}

func headerOf(path string) (tableInfo, error) {
	info := tableInfo{Name: filepath.Base(path)}
	stat, err := os.Stat(path)
	if err != nil {
		return info, err
	}
	info.Size = stat.Size()
	info.Modified = stat.ModTime().Format(time.RFC3339)
	file, err := os.Open(path)
	if err != nil {
		return info, err
	}
	defer file.Close()
	head := make([]byte, 32)
	if _, err := io.ReadFull(file, head); err != nil {
		return info, fmt.Errorf("读取文件头失败：%v", err)
	}
	if !dbxVersions[head[0]] {
		return info, fmt.Errorf("不是可识别的 DBF 文件（版本字节 0x%02X）", head[0])
	}
	info.Records = binary.LittleEndian.Uint32(head[4:8])
	headerLen := int(binary.LittleEndian.Uint16(head[8:10]))
	recordLen := int(binary.LittleEndian.Uint16(head[10:12]))
	if headerLen < 33 || recordLen <= 0 {
		return info, errors.New("DBF 文件头损坏（记录长度或头长度非法）")
	}
	fields := (headerLen - 33) / 32
	if fields > 0 {
		info.Fields = fields
	}
	info.Version = fmt.Sprintf("0x%02X", head[0])
	return info, nil
}

// resolve 把表名限制在连接声明的路径内。
func (p *plugin) resolve(c config, name string) (string, error) {
	dir, err := dirOf(c)
	if err != nil {
		return "", err
	}
	if c.Source != "folder" {
		if name != "" && !strings.EqualFold(filepath.Base(c.File), filepath.Base(name)) {
			return "", errors.New("该连接只允许访问配置的单个文件")
		}
		return c.File, nil
	}
	clean := strings.TrimSpace(name)
	if clean == "" {
		return "", errors.New("需要指定数据表")
	}
	if strings.ContainsAny(clean, "/\\") || clean == "." || clean == ".." {
		return "", errors.New("非法的数据表名")
	}
	ext := strings.ToLower(filepath.Ext(clean))
	if ext != ".dbf" && !memoExts[ext] {
		return "", errors.New("只允许访问 .DBF 及其备注文件")
	}
	full := filepath.Join(dir, clean)
	if !strings.EqualFold(filepath.Clean(filepath.Dir(full)), filepath.Clean(dir)) {
		return "", errors.New("数据表不在连接目录内")
	}
	if info, err := os.Stat(full); err != nil || !info.Mode().IsRegular() {
		return "", fmt.Errorf("数据表不存在：%s", clean)
	}
	return full, nil
}

func (p *plugin) describe(c config) (map[string]any, error) {
	dir, err := dirOf(c)
	if err != nil {
		return nil, err
	}
	tables := []tableInfo{}
	if c.Source == "folder" {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return nil, err
		}
		for _, entry := range entries {
			if entry.IsDir() || !strings.EqualFold(filepath.Ext(entry.Name()), ".dbf") {
				continue
			}
			item, err := headerOf(filepath.Join(dir, entry.Name()))
			if err != nil {
				continue // 跳过损坏或非 DBF 的文件，避免整个连接失败
			}
			item.Memo = c.memoFor(filepath.Join(dir, entry.Name()))
			tables = append(tables, item)
		}
		sort.Slice(tables, func(i, j int) bool { return tables[i].Name < tables[j].Name })
		if len(tables) == 0 {
			return nil, fmt.Errorf("目录中没有可用的 DBF 文件：%s", dir)
		}
	} else {
		item, err := headerOf(c.File)
		if err != nil {
			return nil, err
		}
		item.Memo = c.memoFor(c.File)
		tables = append(tables, item)
	}
	path := c.File
	if c.Source == "folder" {
		path = c.Folder
	}
	return map[string]any{
		"source":     c.Source,
		"path":       path,
		"folder":     dir,
		"encoding":   c.Encoding,
		"allowWrite": c.AllowWrite,
		"tables":     tables,
	}, nil
}

func summary(c config) string {
	if c.Source == "folder" {
		return c.Folder
	}
	return c.File
}

/* -------------------------------------------------------------- RPC methods */

func (p *plugin) Handle(_ dbx.RequestContext, method string, raw json.RawMessage, _ *dbx.Emitter) (any, *dbx.PluginError) {
	switch method {
	case "connection/test":
		var lc lifecycle
		if err := json.Unmarshal(raw, &lc); err != nil {
			return nil, dbx.NewError(-32602, "连接参数非法")
		}
		cfg := lc.config()
		info, err := p.describe(cfg)
		if err != nil {
			return map[string]any{"success": false, "message": err.Error()}, nil
		}
		tables := info["tables"].([]tableInfo)
		if cfg.Source == "folder" {
			return map[string]any{"success": true, "message": fmt.Sprintf("目录可用，发现 %d 个 DBF 数据表", len(tables))}, nil
		}
		head := tables[0]
		return map[string]any{
			"success": true,
			"message": fmt.Sprintf("%s · %d 条记录 · %d 个字段", head.Name, head.Records, head.Fields),
		}, nil

	case "connection/connect":
		var lc lifecycle
		if err := json.Unmarshal(raw, &lc); err != nil {
			return nil, dbx.NewError(-32602, "连接参数非法")
		}
		cfg := lc.config()
		if _, err := p.describe(cfg); err != nil {
			return map[string]any{"success": false, "message": err.Error()}, nil
		}
		p.mu.Lock()
		p.conns[lc.Connection.ID] = cfg
		p.saveConfigs()
		p.mu.Unlock()
		return map[string]any{"success": true, "message": summary(cfg)}, nil

	case "connection/disconnect":
		var lc lifecycle
		if err := json.Unmarshal(raw, &lc); err == nil {
			p.mu.Lock()
			delete(p.conns, lc.Connection.ID)
			p.saveConfigs()
			p.mu.Unlock()
		}
		return map[string]any{"success": true}, nil

	case "dbf/info":
		var req struct {
			ConnectionID string `json:"connectionId"`
		}
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, dbx.NewError(-32602, "参数非法")
		}
		cfg, err := p.connection(req.ConnectionID)
		if err != nil {
			return nil, dbx.NewError(-32000, err.Error())
		}
		info, err := p.describe(cfg)
		if err != nil {
			return nil, dbx.NewError(-32000, err.Error())
		}
		info["connectionId"] = req.ConnectionID
		return info, nil

	case "dbf/read":
		var req struct {
			ConnectionID string `json:"connectionId"`
			Name         string `json:"name"`
			Offset       int64  `json:"offset"`
			Length       int64  `json:"length"`
		}
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, dbx.NewError(-32602, "参数非法")
		}
		if req.Offset < 0 || req.Length < 0 {
			return nil, dbx.NewError(-32602, "偏移或长度非法")
		}
		if req.Length == 0 || req.Length > maxReadChunk {
			req.Length = maxReadChunk
		}
		cfg, err := p.connection(req.ConnectionID)
		if err != nil {
			return nil, dbx.NewError(-32000, err.Error())
		}
		path, err := p.resolve(cfg, req.Name)
		if err != nil {
			return nil, dbx.NewError(-32000, err.Error())
		}
		file, err := os.Open(path)
		if err != nil {
			return nil, dbx.NewError(-32000, err.Error())
		}
		defer file.Close()
		stat, err := file.Stat()
		if err != nil {
			return nil, dbx.NewError(-32000, err.Error())
		}
		if req.Offset > stat.Size() {
			req.Offset = stat.Size()
		}
		buf := make([]byte, req.Length)
		n, err := file.ReadAt(buf, req.Offset)
		if err != nil && !errors.Is(err, io.EOF) {
			return nil, dbx.NewError(-32000, err.Error())
		}
		buf = buf[:n]
		return map[string]any{
			"dataBase64": base64.StdEncoding.EncodeToString(buf),
			"length":     n,
			"total":      stat.Size(),
			"eof":        req.Offset+int64(n) >= stat.Size(),
		}, nil

	case "dbf/write-begin":
		var req struct {
			ConnectionID string `json:"connectionId"`
			Name         string `json:"name"`
			Size         int64  `json:"size"`
		}
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, dbx.NewError(-32602, "参数非法")
		}
		cfg, err := p.connection(req.ConnectionID)
		if err != nil {
			return nil, dbx.NewError(-32000, err.Error())
		}
		if !cfg.AllowWrite {
			return nil, dbx.NewError(-32000, "该连接为只读，未允许写回文件")
		}
		if req.Size <= 0 || req.Size > 512*1024*1024 {
			return nil, dbx.NewError(-32602, "文件大小非法")
		}
		path, err := p.resolve(cfg, req.Name)
		if err != nil {
			return nil, dbx.NewError(-32000, err.Error())
		}
		if !strings.EqualFold(filepath.Ext(path), ".dbf") {
			return nil, dbx.NewError(-32000, "只能写回 .DBF 文件")
		}
		p.mu.Lock()
		p.seq++
		token := fmt.Sprintf("w-%d-%d", time.Now().UnixNano(), p.seq)
		tmp := path + fmt.Sprintf(".dbx-%d.tmp", p.seq)
		file, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
		if err != nil {
			p.mu.Unlock()
			return nil, dbx.NewError(-32000, err.Error())
		}
		p.writes[token] = &writeSession{file: file, tmp: tmp, target: path}
		p.mu.Unlock()
		return map[string]any{"token": token, "target": filepath.Base(path)}, nil

	case "dbf/write-chunk":
		var req struct {
			Token      string `json:"token"`
			Offset     int64  `json:"offset"`
			DataBase64 string `json:"dataBase64"`
		}
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, dbx.NewError(-32602, "参数非法")
		}
		data, err := base64.StdEncoding.DecodeString(req.DataBase64)
		if err != nil {
			return nil, dbx.NewError(-32602, "数据块不是合法 base64")
		}
		if len(data) == 0 || len(data) > maxWriteByte {
			return nil, dbx.NewError(-32602, "数据块大小非法")
		}
		p.mu.Lock()
		session, ok := p.writes[req.Token]
		p.mu.Unlock()
		if !ok {
			return nil, dbx.NewError(-32000, "写入会话不存在或已结束")
		}
		if req.Offset != session.written {
			return nil, dbx.NewError(-32000, "数据块顺序不正确")
		}
		n, err := session.file.Write(data)
		if err != nil {
			return nil, dbx.NewError(-32000, err.Error())
		}
		session.written += int64(n)
		return map[string]any{"written": session.written}, nil

	case "dbf/write-commit":
		var req struct {
			Token string `json:"token"`
		}
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, dbx.NewError(-32602, "参数非法")
		}
		p.mu.Lock()
		session, ok := p.writes[req.Token]
		delete(p.writes, req.Token)
		p.mu.Unlock()
		if !ok {
			return nil, dbx.NewError(-32000, "写入会话不存在或已结束")
		}
		_ = session.file.Sync()
		_ = session.file.Close()
		backup := ""
		if _, err := os.Stat(session.target); err == nil {
			backup = session.target + ".bak"
			_ = os.Remove(backup)
			if err := os.Rename(session.target, backup); err != nil {
				_ = os.Remove(session.tmp)
				return nil, dbx.NewError(-32000, "备份原文件失败："+err.Error())
			}
		}
		if err := os.Rename(session.tmp, session.target); err != nil {
			if backup != "" {
				_ = os.Rename(backup, session.target)
			}
			_ = os.Remove(session.tmp)
			return nil, dbx.NewError(-32000, "替换文件失败："+err.Error())
		}
		return map[string]any{
			"success": true,
			"path":    session.target,
			"size":    session.written,
			"backup":  backup,
		}, nil

	case "dbf/write-abort":
		var req struct {
			Token string `json:"token"`
		}
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, dbx.NewError(-32602, "参数非法")
		}
		p.mu.Lock()
		session, ok := p.writes[req.Token]
		delete(p.writes, req.Token)
		p.mu.Unlock()
		if ok {
			_ = session.file.Close()
			_ = os.Remove(session.tmp)
		}
		return map[string]any{"success": true}, nil

	case "plugin/shutdown":
		return map[string]any{"success": true}, nil
	}
	return nil, dbx.MethodNotFound(method)
}

func (p *plugin) connection(id string) (config, error) {
	if strings.TrimSpace(id) == "" {
		return config{}, errors.New("缺少连接标识")
	}
	p.mu.Lock()
	cfg, ok := p.conns[id]
	p.mu.Unlock()
	if !ok {
		return config{}, errors.New("连接未就绪，请在 DBX 中重新打开该连接")
	}
	return cfg, nil
}

func main() {
	metadata := dbx.Metadata{
		ID:      pluginID,
		Version: pluginVersion,
		Capabilities: []string{
			"connection:test",
			"connection:connect",
			"dbf:read",
			"dbf:write",
		},
	}
	server := dbx.NewServer(metadata, newPlugin())
	if err := server.Serve(); err != nil {
		fmt.Fprintln(os.Stderr, "[dbx-dbf] "+err.Error())
		os.Exit(1)
	}
}




