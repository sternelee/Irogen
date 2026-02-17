// Platform-independent tools (available on all platforms)
pub mod composio;
pub mod file_read;
pub mod file_write;
pub mod http_request;
pub mod image_info;
pub mod memory_forget;
pub mod memory_recall;
pub mod memory_store;
pub mod traits;

// Desktop-only tools (shell, git, browser, screenshot, hardware)
#[cfg(feature = "desktop")]
pub mod browser;
#[cfg(feature = "desktop")]
pub mod browser_open;
#[cfg(feature = "desktop")]
pub mod git_operations;
#[cfg(feature = "desktop")]
pub mod hardware_board_info;
#[cfg(feature = "desktop")]
pub mod hardware_memory_map;
#[cfg(feature = "desktop")]
pub mod hardware_memory_read;
#[cfg(feature = "desktop")]
pub mod screenshot;
#[cfg(feature = "desktop")]
pub mod shell;

// Re-exports
pub use composio::ComposioTool;
pub use file_read::FileReadTool;
pub use file_write::FileWriteTool;
pub use http_request::HttpRequestTool;
pub use image_info::ImageInfoTool;
pub use memory_forget::MemoryForgetTool;
pub use memory_recall::MemoryRecallTool;
pub use memory_store::MemoryStoreTool;
pub use traits::Tool;
#[allow(unused_imports)]
pub use traits::{ToolResult, ToolSpec};

#[cfg(feature = "desktop")]
pub use browser::{BrowserTool, ComputerUseConfig};
#[cfg(feature = "desktop")]
pub use browser_open::BrowserOpenTool;
#[cfg(feature = "desktop")]
pub use git_operations::GitOperationsTool;
#[cfg(feature = "desktop")]
pub use hardware_board_info::HardwareBoardInfoTool;
#[cfg(feature = "desktop")]
pub use hardware_memory_map::HardwareMemoryMapTool;
#[cfg(feature = "desktop")]
pub use hardware_memory_read::HardwareMemoryReadTool;
#[cfg(feature = "desktop")]
pub use screenshot::ScreenshotTool;
#[cfg(feature = "desktop")]
pub use shell::ShellTool;

use crate::memory::Memory;
use crate::runtime::{NativeRuntime, RuntimeAdapter};
use crate::security::SecurityPolicy;
use std::sync::Arc;

/// Tools available on all platforms (mobile + desktop)
pub fn universal_tools(security: &Arc<SecurityPolicy>) -> Vec<Box<dyn Tool>> {
    universal_tools_with_runtime(security, Arc::new(NativeRuntime::new()))
}

/// Tools available on all platforms with custom runtime
pub fn universal_tools_with_runtime(
    security: &Arc<SecurityPolicy>,
    runtime: Arc<dyn RuntimeAdapter>,
) -> Vec<Box<dyn Tool>> {
    vec![
        Box::new(FileReadTool::new(security.clone(), runtime.clone())),
        Box::new(FileWriteTool::new(security.clone(), runtime)),
        Box::new(HttpRequestTool::with_security(security.clone())),
        Box::new(ImageInfoTool::new(security.clone())),
    ]
}

/// Tools with memory support (all platforms)
pub fn universal_tools_with_memory(
    security: &Arc<SecurityPolicy>,
    memory: Arc<dyn Memory>,
) -> Vec<Box<dyn Tool>> {
    let mut tools = universal_tools_with_runtime(security, Arc::new(NativeRuntime::new()));
    tools.extend([
        Box::new(MemoryStoreTool::new(memory.clone())) as Box<dyn Tool>,
        Box::new(MemoryRecallTool::new(memory.clone())) as Box<dyn Tool>,
        Box::new(MemoryForgetTool::new(memory)) as Box<dyn Tool>,
    ]);
    tools
}

/// Desktop-only tools (shell, git, browser, screenshot, hardware)
#[cfg(feature = "desktop")]
pub fn desktop_tools(security: &Arc<SecurityPolicy>) -> Vec<Box<dyn Tool>> {
    desktop_tools_with_runtime(security, Arc::new(NativeRuntime::new()))
}

/// Desktop-only tools with custom runtime
#[cfg(feature = "desktop")]
pub fn desktop_tools_with_runtime(
    security: &Arc<SecurityPolicy>,
    runtime: Arc<dyn RuntimeAdapter>,
) -> Vec<Box<dyn Tool>> {
    vec![
        Box::new(ShellTool::new(security.clone(), runtime.clone())),
        Box::new(FileReadTool::new(security.clone(), runtime.clone())),
        Box::new(FileWriteTool::new(security.clone(), runtime)),
        Box::new(GitOperationsTool::with_security(security.clone())),
        Box::new(HttpRequestTool::with_security(security.clone())),
        Box::new(ImageInfoTool::new(security.clone())),
        Box::new(ScreenshotTool::new(security.clone())),
    ]
}

/// All desktop tools including memory
#[cfg(feature = "desktop")]
pub fn desktop_tools_with_memory(
    security: &Arc<SecurityPolicy>,
    memory: Arc<dyn Memory>,
) -> Vec<Box<dyn Tool>> {
    let mut tools = desktop_tools_with_runtime(security, Arc::new(NativeRuntime::new()));
    tools.extend([
        Box::new(MemoryStoreTool::new(memory.clone())) as Box<dyn Tool>,
        Box::new(MemoryRecallTool::new(memory.clone())) as Box<dyn Tool>,
        Box::new(MemoryForgetTool::new(memory)) as Box<dyn Tool>,
    ]);
    tools
}

/// Default tools for backward compatibility (desktop-only, matches original behavior)
#[cfg(feature = "desktop")]
pub fn default_tools(security: Arc<SecurityPolicy>) -> Vec<Box<dyn Tool>> {
    default_tools_with_runtime(security, Arc::new(NativeRuntime::new()))
}

#[cfg(feature = "desktop")]
pub fn default_tools_with_runtime(
    security: Arc<SecurityPolicy>,
    runtime: Arc<dyn RuntimeAdapter>,
) -> Vec<Box<dyn Tool>> {
    vec![
        Box::new(ShellTool::new(security.clone(), runtime.clone())),
        Box::new(FileReadTool::new(security.clone(), runtime.clone())),
        Box::new(FileWriteTool::new(security, runtime)),
    ]
}

#[cfg(feature = "desktop")]
pub fn all_tools(security: &Arc<SecurityPolicy>, memory: Arc<dyn Memory>) -> Vec<Box<dyn Tool>> {
    all_tools_with_runtime(security, Arc::new(NativeRuntime::new()), memory)
}

#[cfg(feature = "desktop")]
pub fn all_tools_with_runtime(
    security: &Arc<SecurityPolicy>,
    runtime: Arc<dyn RuntimeAdapter>,
    memory: Arc<dyn Memory>,
) -> Vec<Box<dyn Tool>> {
    vec![
        Box::new(ShellTool::new(security.clone(), runtime.clone())),
        Box::new(FileReadTool::new(security.clone(), runtime.clone())),
        Box::new(FileWriteTool::new(security.clone(), runtime.clone())),
        Box::new(MemoryStoreTool::new(memory.clone())),
        Box::new(MemoryRecallTool::new(memory.clone())),
        Box::new(MemoryForgetTool::new(memory)),
    ]
}

// For mobile builds, provide minimal default tools
#[cfg(not(feature = "desktop"))]
pub fn default_tools(security: Arc<SecurityPolicy>) -> Vec<Box<dyn Tool>> {
    universal_tools(&security)
}

#[cfg(not(feature = "desktop"))]
pub fn all_tools(security: &Arc<SecurityPolicy>, memory: Arc<dyn Memory>) -> Vec<Box<dyn Tool>> {
    universal_tools_with_memory(security, memory)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn universal_tools_count() {
        let security = Arc::new(SecurityPolicy::default());
        let tools = universal_tools(&security);
        assert_eq!(tools.len(), 4);
    }

    #[test]
    fn universal_tools_names() {
        let security = Arc::new(SecurityPolicy::default());
        let tools = universal_tools(&security);
        let names: Vec<&str> = tools.iter().map(|t| t.name()).collect();
        assert!(names.contains(&"file_read"));
        assert!(names.contains(&"file_write"));
        assert!(names.contains(&"http_request"));
        assert!(names.contains(&"image_info"));
    }

    #[cfg(feature = "desktop")]
    #[test]
    fn desktop_tools_includes_shell() {
        let security = Arc::new(SecurityPolicy::default());
        let tools = desktop_tools(&security);
        let names: Vec<&str> = tools.iter().map(|t| t.name()).collect();
        assert!(names.contains(&"shell"));
        assert!(names.contains(&"git_operations"));
        assert!(names.contains(&"screenshot"));
    }
}
