use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalEvent {
    pub timestamp: f64,
    pub event_type: EventType,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EventType {
    Output,
    Input,
    Resize { width: u16, height: u16 },
    Start,
    End,
}
