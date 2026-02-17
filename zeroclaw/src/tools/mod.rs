pub mod browser;
pub mod browser_open;
pub mod composio;
pub mod file_read;
pub mod file_write;
pub mod git_operations;
pub mod hardware_board_info;
pub mod hardware_memory_map;
pub mod hardware_memory_read;
pub mod http_request;
pub mod image_info;
pub mod memory_forget;
pub mod memory_recall;
pub mod memory_store;
pub mod screenshot;
pub mod shell;
pub mod traits;

pub use browser::{BrowserTool, ComputerUseConfig};
pub use browser_open::BrowserOpenTool;
pub use composio::ComposioTool;
pub use file_read::FileReadTool;
pub use file_write::FileWriteTool;
pub use git_operations::GitOperationsTool;
pub use hardware_board_info::HardwareBoardInfoTool;
pub use hardware_memory_map::HardwareMemoryMapTool;
pub use hardware_memory_read::HardwareMemoryReadTool;
pub use http_request::HttpRequestTool;
pub use image_info::ImageInfoTool;
pub use memory_forget::MemoryForgetTool;
pub use memory_recall::MemoryRecallTool;
pub use memory_store::MemoryStoreTool;
pub use screenshot::ScreenshotTool;
pub use shell::ShellTool;
pub use traits::Tool;
#[allow(unused_imports)]
pub use traits::{ToolResult, ToolSpec};

use crate::memory::Memory;
use crate::runtime::{NativeRuntime, RuntimeAdapter};
use crate::security::SecurityPolicy;
use std::sync::Arc;

pub fn default_tools(security: Arc<SecurityPolicy>) -> Vec<Box<dyn Tool>> {
    default_tools_with_runtime(security, Arc::new(NativeRuntime::new()))
}

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

pub fn all_tools(security: &Arc<SecurityPolicy>, memory: Arc<dyn Memory>) -> Vec<Box<dyn Tool>> {
    all_tools_with_runtime(security, Arc::new(NativeRuntime::new()), memory)
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_tools_has_three() {
        let security = Arc::new(SecurityPolicy::default());
        let tools = default_tools(security);
        assert_eq!(tools.len(), 3);
    }

    #[test]
    fn default_tools_names() {
        let security = Arc::new(SecurityPolicy::default());
        let tools = default_tools(security);
        let names: Vec<&str> = tools.iter().map(|t| t.name()).collect();
        assert!(names.contains(&"shell"));
        assert!(names.contains(&"file_read"));
        assert!(names.contains(&"file_write"));
    }
}
