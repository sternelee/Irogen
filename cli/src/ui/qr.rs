use qrcode::QrCode;

/// Handles QR code generation and display
pub struct QrCodeGenerator;

impl QrCodeGenerator {
    pub fn display_qr_code(ticket: &str) {
        match QrCode::new(ticket.as_bytes()) {
            Ok(qr_code) => {
                let qr_string = qr_code
                    .render::<char>()
                    .quiet_zone(true)
                    .module_dimensions(2, 1)
                    .build();
                println!("🎫 Scan the QR code below to join this session:");
                println!("\n{}\n", qr_string);
            }
            Err(e) => {
                eprintln!("Failed to generate QR code: {}", e);
            }
        }
    }

    pub fn generate_qr_string(data: &str) -> Result<String, qrcode::types::QrError> {
        let qr_code = QrCode::new(data.as_bytes())?;
        Ok(qr_code
            .render::<char>()
            .quiet_zone(true)
            .module_dimensions(2, 1)
            .build())
    }
}