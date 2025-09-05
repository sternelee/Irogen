use ansi_term::Color::{Cyan, Fixed, Green};
use anyhow::Result;
use clap::Parser;
use tokio::signal;

use crate::controller::Controller;
use crate::p2p::P2PNetwork;
use crate::runner::Runner;
use crate::terminal_impl::get_default_shell;

/// 安全的基于 Web 的协作终端，使用 iroh P2P 网络
#[derive(Parser, Debug)]
#[clap(author, version, about, long_about = None)]
struct Args {
    /// 本地 shell 命令在终端中运行
    #[clap(long)]
    shell: Option<String>,

    /// 安静模式，只将 URL 打印到 stdout
    #[clap(short, long)]
    quiet: bool,

    /// 会话标题中显示的会话名称（默认为 user@hostname）
    #[clap(long)]
    name: Option<String>,

    /// 启用只读访问模式 - 为查看者和编辑者生成单独的 URL
    #[clap(long)]
    enable_readers: bool,
}

fn print_greeting(shell: &str, controller: &Controller, network: &P2PNetwork) {
    let version_str = match option_env!("CARGO_PKG_VERSION") {
        Some(version) => format!("v{version}"),
        None => String::from("[dev]"),
    };

    let status_indicator = if controller.is_restored() {
        format!(" {}", Fixed(8).paint("(已恢复)"))
    } else {
        String::new()
    };

    // 获取 node_id 和网络信息
    let node_id = tokio::task::block_in_place(|| {
        tokio::runtime::Handle::current().block_on(async {
            network.get_node_id().await
        })
    });
    
    let node_info = format!("Node ID: {}", &node_id[..12]); // 显示前12个字符

    if let Some(write_ticket) = controller.write_ticket() {
        println!(
            r#"
  {app_name} {version}{status}

  {arr}  {node_info_v}
  {arr}  只读票据: {ticket_v}
  {arr}  可写票据: {write_ticket_v}
  {arr}  Shell:    {shell_v}

  {info} 扫描二维码或复制票据分享给协作者
  {info} 会话将保持活跃直到所有参与者断开连接
"#,
            app_name = Green.bold().paint("iroh-code-remote"),
            version = Green.paint(&version_str),
            status = status_indicator,
            arr = Green.paint("➜"),
            node_info_v = Fixed(8).paint(&node_info),
            ticket_v = Cyan.underline().paint(controller.ticket()),
            write_ticket_v = Cyan.underline().paint(write_ticket),
            shell_v = Fixed(8).paint(shell),
            info = Fixed(8).paint("ℹ"),
        );
    } else {
        println!(
            r#"
  {app_name} {version}{status}

  {arr}  {node_info_v}
  {arr}  票据:   {ticket_v}
  {arr}  Shell:  {shell_v}

  {info} 扫描二维码或复制票据分享给协作者
  {info} 会话将保持活跃直到所有参与者断开连接
"#,
            app_name = Green.bold().paint("iroh-code-remote"),
            version = Green.paint(&version_str),
            status = status_indicator,
            arr = Green.paint("➜"),
            node_info_v = Fixed(8).paint(&node_info),
            ticket_v = Cyan.underline().paint(controller.ticket()),
            shell_v = Fixed(8).paint(shell),
            info = Fixed(8).paint("ℹ"),
        );
    }

    // 显示二维码
    display_qr_code(controller.ticket());
}

fn display_qr_code(ticket: &str) {
    use fast_qr::convert::{image::ImageBuilder, Builder, Shape};
    use fast_qr::QRBuilder;

    println!("\n{} {}", Fixed(8).paint("📱"), Fixed(8).paint("扫描二维码加入会话:"));

    match QRBuilder::new(ticket).build() {
        Ok(qr) => {
            let image = ImageBuilder::default()
                .shape(Shape::Square)
                .background_color([255, 255, 255, 0]) // 透明背景
                .fit_width(400)
                .to_pixmap(&qr);

            // 将二维码转换为 ASCII 字符显示
            let width = image.width();
            let height = image.height();
            
            for y in (0..height).step_by(2) {
                print!("  "); // 左边距
                for x in 0..width {
                    let pixel = image.pixel(x, y);
                    let brightness = if let Some(p) = pixel {
                        (p.red() as u32 + p.green() as u32 + p.blue() as u32) / 3
                    } else {
                        255 // 默认白色
                    };
                    
                    // 检查下一行的像素（如果存在）
                    let lower_brightness = if y + 1 < height {
                        let lower_pixel = image.pixel(x, y + 1);
                        if let Some(p) = lower_pixel {
                            (p.red() as u32 + p.green() as u32 + p.blue() as u32) / 3
                        } else {
                            255 // 默认白色
                        }
                    } else {
                        255
                    };
                    
                    // 使用半方块字符显示上下两个像素
                    let ch = match (brightness < 128, lower_brightness < 128) {
                        (true, true) => '█',    // 都是黑色
                        (true, false) => '▀',   // 上黑下白
                        (false, true) => '▄',   // 上白下黑  
                        (false, false) => ' ',  // 都是白色
                    };
                    print!("{}", ch);
                }
                println!();
            }
        }
        Err(_) => {
            println!("  {} 无法生成二维码", Fixed(8).paint("❌"));
        }
    }
    println!();
}

async fn start(args: Args) -> Result<()> {
    let shell = match args.shell {
        Some(shell) => shell,
        None => get_default_shell().await,
    };

    let name = args.name.unwrap_or_else(|| {
        let mut name = whoami::username();
        if let Ok(host) = whoami::fallible::hostname() {
            // 修剪像 .lan 或 .local 这样的域信息
            let host = host.split('.').next().unwrap_or(&host);
            name += "@";
            name += host;
        }
        name
    });

    let runner = Runner::Shell(shell.clone());

    // 初始化 P2P 网络
    let network = P2PNetwork::new(None).await?;
    let network_clone = network.clone();

    let mut controller = Controller::new(&name, runner, args.enable_readers, network).await?;

    if args.quiet {
        if let Some(write_ticket) = controller.write_ticket() {
            println!("{}", write_ticket);
        } else {
            println!("{}", controller.ticket());
        }
    } else {
        print_greeting(&shell, &controller, &network_clone);
    }

    let exit_signal = signal::ctrl_c();
    tokio::pin!(exit_signal);
    tokio::select! {
        _ = controller.run() => unreachable!(),
        Ok(()) = &mut exit_signal => (),
    };
    controller.close().await?;

    Ok(())
}

pub async fn run_sshx() -> Result<()> {
    let args = Args::parse();
    start(args).await
}

