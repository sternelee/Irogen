//! ZeroClaw — lightweight AI agent with multi-provider LLM support, tool execution, and memory.
//!
//! This crate provides the core agent functionality for RiTerm's built-in ZeroClaw agent,
//! supporting 22+ LLM providers, shell/file tools, SQLite memory, and security policies.

pub mod agent;
pub mod config;
pub mod memory;
pub mod providers;
pub mod runtime;
pub mod security;
pub mod tools;
pub mod util;
