# 配置持久化模式：内存态缓存与防抖异步落盘

## 1. 概述

FluxTerm 采用“内存态缓存 + 防抖异步落盘”作为统一的配置持久化模型。该方案通过前端内存状态保证界面响应，通过后端原子写入保证数据完整性，并利用防抖策略合并高频 I/O 请求。

## 2. 核心流程

### 2.1 加载阶段（Bootstrap）

1. Rust 后端在应用启动或功能模块初始化时读取 `.json` 配置文件
2. 数据经由 Rust `serde` 校验后，通过 Tauri Command 注入前端
3. 前端将数据写入 React State，运行期间以内存态作为事实源

### 2.2 运行阶段（Runtime）

1. 用户交互直接同步到 React 内存状态
2. UI 响应不依赖同步磁盘 I/O

### 2.3 持久化阶段（Persistence）

1. Hook 监听内存状态变化
2. 触发保存前，通过 `JSON.stringify` 或深度比较与 `lastSavedConfigRef` 进行脏检查
3. 使用全局常量 `PERSISTENCE_SAVE_DEBOUNCE_MS` 进行防抖排期
4. 后端执行 `write_atomic`：
   - 写入 `.tmp` 临时文件
   - 执行 `sync_all` 刷盘
   - 通过系统级 `rename` 覆盖原文件

## 3. 实施规范

### 3.1 前端 Hook 模板

所有涉及持久化的 Hook 应遵循以下模式：

```typescript
import { PERSISTENCE_SAVE_DEBOUNCE_MS } from "@/constants/persistence";

export default function useYourSettings() {
  const [config, setConfig] = useState(defaultConfig);
  const loadedRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const lastSavedConfigRef = useRef<string>("");

  useEffect(() => {
    if (!loadedRef.current) return;

    const configStr = JSON.stringify(config);
    if (configStr === lastSavedConfigRef.current) return;

    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);

    saveTimerRef.current = window.setTimeout(async () => {
      try {
        await invoke("save_command", { payload: config });
        lastSavedConfigRef.current = configStr;
      } catch (error) {
        // 异常处理
      }
    }, PERSISTENCE_SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [config]);
}
```

### 3.2 后端原子写入

后端通过 `crate::utils::write_atomic` 执行落盘，其内部标准逻辑如下：

```rust
pub fn write_atomic<P: AsRef<Path>>(path: P, content: &str) -> Result<(), EngineError> {
    // 1. 创建临时文件 (.tmp)
    // 2. 写入字节流
    // 3. 执行 fsync (sync_all)
    // 4. 重命名覆盖原文件
}
```

## 4. 可观测性

为便于诊断配置同步问题，持久化系统在关键节点输出标准 `debug` 级别日志：

- 加载节点：记录读取路径、字节大小与最终负载
- 保存节点：记录保存排期、防抖时长与物理写入完成状态
- 物理层：记录临时文件创建、刷盘与目标文件替换过程

## 5. 方案收益

1. 原子写入降低了配置文件损坏风险
2. 防抖策略显著减少高频磁盘写入
3. 直接使用用户主目录下的 `.json` 文件，便于备份、检查与调试
