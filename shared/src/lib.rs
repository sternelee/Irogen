// Agent module only for desktop (std feature)
#[cfg(feature = "std")]
pub mod agent;
pub mod event_manager;
pub mod message_protocol;
pub mod message_store;
pub mod message_sync;
pub mod quic_server;
pub mod util;

pub use event_manager::*;
pub use message_protocol::*;
pub use message_store::*;
pub use message_sync::*;
pub use quic_server::*;
pub use util::*;

#[cfg(feature = "std")]
pub use agent::AgentManager;
#[cfg(feature = "std")]
pub use agent::AgentTurnEvent;
#[cfg(feature = "std")]
pub use agent::message_adapter;
#[cfg(feature = "std")]
pub use agent::{Agent, AgentFactory};
