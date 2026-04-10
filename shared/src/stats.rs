//! 系统状态收集模块
//!
//! 提供系统运行状态的收集功能，包括 CPU、内存、磁盘、网络等

use anyhow::Result;
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(feature = "std")]
use sysinfo::{Disks, Networks, System};

use crate::message_protocol::{LoadAverage, NetworkStats, SystemStats};

/// 收集系统运行状态
#[cfg(feature = "std")]
pub fn collect_system_stats() -> Result<SystemStats> {
    let mut sys = System::new_all();
    sys.refresh_all();

    // CPU 使用率
    let cpu_usage = sys.global_cpu_usage();

    // 内存信息
    let total_memory = sys.total_memory();
    let used_memory = sys.used_memory();
    let memory_usage = if total_memory > 0 {
        (used_memory as f64 / total_memory as f64 * 100.0) as f32
    } else {
        0.0
    };

    // 磁盘信息
    let disks = Disks::new_with_refreshed_list();
    let mut total_disk = 0u64;
    let mut used_disk = 0u64;

    for disk in &disks {
        total_disk += disk.total_space();
        used_disk += disk.total_space() - disk.available_space();
    }

    let disk_usage = if total_disk > 0 {
        (used_disk as f64 / total_disk as f64 * 100.0) as f32
    } else {
        0.0
    };

    // 系统运行时间
    let uptime = System::uptime();

    // 负载平均值 (仅 Unix 系统)
    #[cfg(unix)]
    let load_avg = {
        use std::fs;
        let loadavg_content = fs::read_to_string("/proc/loadavg").ok();
        loadavg_content.and_then(|content| {
            let parts: Vec<&str> = content.split_whitespace().collect();
            if parts.len() >= 3 {
                Some(LoadAverage {
                    one: parts[0].parse().ok()?,
                    five: parts[1].parse().ok()?,
                    fifteen: parts[2].parse().ok()?,
                })
            } else {
                None
            }
        })
    };

    #[cfg(not(unix))]
    let load_avg: Option<LoadAverage> = None;

    // 网络统计
    let networks = Networks::new_with_refreshed_list();
    let network_stats = networks.iter().next().map(|(_, data)| NetworkStats {
        bytes_received: data.received(),
        bytes_sent: data.transmitted(),
        packets_received: data.packets_received(),
        packets_sent: data.packets_transmitted(),
    });

    // 时间戳
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    Ok(SystemStats {
        cpu_usage,
        memory_usage,
        total_memory,
        used_memory,
        disk_usage,
        total_disk,
        used_disk,
        uptime,
        load_avg,
        network_stats,
        timestamp,
    })
}

/// Mobile 版本的系统状态收集 (简化版)
#[cfg(not(feature = "std"))]
pub fn collect_system_stats() -> Result<SystemStats> {
    // Mobile 版本返回基础信息
    Ok(SystemStats {
        cpu_usage: 0.0,
        memory_usage: 0.0,
        total_memory: 0,
        used_memory: 0,
        disk_usage: 0.0,
        total_disk: 0,
        used_disk: 0,
        uptime: 0,
        load_avg: None,
        network_stats: None,
        timestamp: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    })
}
