# 配置持久化方案：内存态缓存 + 防抖异步落盘

## 1. 方案概述

FluxTerm 采用 **“内存态缓存 + 防抖异步落盘”** 作为统一的配置持久化模型。该方案旨在通过前端内存状态保证 UI 响应的零延迟，通过后端原子化写入保证数据的绝对安全，并利用防抖技术最大程度合并 I/O 请求，提升系统稳定性。

---

## 2. 核心架构逻辑

### 2.1 加载阶段 (Bootstrap)

1. **物理读取：** Rust 后端在应用启动或功能模块初始化时，从磁盘加载 `.json` 配置文件。
2. **反序列化：** 数据经由 Rust `serde` 校验后，通过 Tauri Command 注入前端。
3. **内存同步：** 前端将数据存入 React State。此时，内存态成为应用运行期间的“唯一真相源 (Source of Truth)”。

### 2.2 运行阶段 (Runtime)

1. **即时响应：** 用户的所有交互（如修改设置、调整布局）直接同步到 React 内存状态。
2. **UI 零延迟：** 由于不涉及同步 I/O，界面操作在微秒级完成响应，不受磁盘性能影响。

### 2.3 持久化阶段 (Persistence)

1. **内容侦听：** Hook 实时监听内存状态的变化。
2. **内容对比 (Dirty Check)：** 触发保存前，通过 `JSON.stringify` 或深度对比将当前状态与 `lastSavedConfigRef` 进行匹配。若内容未发生实质变化，则拦截保存请求。
3. **防抖处理 (Debounce)：** 使用全局常量 `PERSISTENCE_SAVE_DEBOUNCE_MS` 进行排期。在连续操作期间，计时器会不断重置，仅在操作停止后的静默期触发一次请求。
4. **原子写入：** 后端执行 `write_atomic` 流程：
    * 将内容写入 `.tmp` 临时文件。
    * 执行 `sync_all` 强制刷入磁盘硬件。
    * 通过系统级 `rename` 覆盖原文件，确保物理层面的写入原子性。

---

## 3. 实施规范与范式

### 3.1 前端 Hook 标准模板

所有涉及持久化的 Hook 应遵循以下代码模式：

```typescript
// 1. 引用全局防抖常量
import { PERSISTENCE_SAVE_DEBOUNCE_MS } from "@/constants/persistence";

export default function useYourSettings() {
  const [config, setConfig] = useState(defaultConfig);
  const loadedRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const lastSavedConfigRef = useRef<string>("");

  // 2. 防抖异步保存逻辑
  useEffect(() => {
    if (!loadedRef.current) return;

    const configStr = JSON.stringify(config);
    // 脏检查：避免因引用变动导致的重复 I/O
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

    return () => { if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current); };
  }, [config]);
}
```

### 3.2 后端 Rust 原子写入标准

后端应调用 `crate::utils::write_atomic` 函数执行落盘，其内部标准逻辑如下：

```rust
pub fn write_atomic<P: AsRef<Path>>(path: P, content: &str) -> Result<(), EngineError> {
    // 1. 创建临时文件 (.tmp)
    // 2. 写入字节流
    // 3. 执行 fsync (sync_all)
    // 4. 重命名覆盖原文件
}
```

---

## 4. 可观测性 (Logging)

为了便于排查配置同步问题，持久化系统在关键节点植入了标准的 `debug` 级别日志：

* **加载节点：** 记录文件读取路径、字节大小以及最终加载的负载内容。
* **保存节点：** 记录保存排期（Scheduled）、防抖时长以及物理写入完成后的状态。
* **物理层：** 记录临时文件创建、物理刷新（Sync）和替换目标文件的每一个步骤。

---

## 5. 方案收益

1. **数据完整性：** 原子写入机制彻底消除了因断电或崩溃导致的配置文件损坏（0字节文件）风险。
2. **极端性能：** 防抖技术将原本可能产生的成百上千次磁盘写入合并为极低频的单次操作，显著降低了 CPU 和 I/O 负载。
3. **架构透明：** 直接操作用户主目录下的 `.json` 文件，既方便用户手动备份，也便于开发者通过常规文本工具进行调试。
