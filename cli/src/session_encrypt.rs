use aes::cipher::{KeyIvInit, StreamCipher, StreamCipherSeek};

type Aes128Ctr64BE = ctr::Ctr64BE<aes::Aes128>;

// 类似 sshx 的 KDF salt，用于增强 83-bit 密钥的安全性
const SALT: &str =
    "iroh-code-remote salt for stretching security of session keys - keep this consistent!";

/// 基于 sshx Encrypt 实现的流加密器
/// 使用 Argon2 哈希密钥并通过 AES-128-CTR 进行流加密
#[derive(Clone, Debug)]
pub struct SessionEncrypt {
    aes_key: [u8; 16], // AES-128 密钥
}

impl SessionEncrypt {
    /// 构造新的加密器，使用 Argon2 派生密钥
    /// 参数必须与浏览器端实现匹配
    pub fn new(key: &str) -> Self {
        use argon2::{Algorithm, Argon2, Params, Version};

        // 这些参数必须与 sshx 的浏览器实现匹配
        let hasher = Argon2::new(
            Algorithm::Argon2id,
            Version::V0x13,
            Params::new(19 * 1024, 2, 1, Some(16)).unwrap(),
        );

        let mut aes_key = [0; 16];
        hasher
            .hash_password_into(key.as_bytes(), SALT.as_bytes(), &mut aes_key)
            .expect("failed to hash key with argon2");

        Self { aes_key }
    }

    /// 获取加密的零块，用于验证密钥正确性
    /// 类似 sshx 的 zeros() 方法
    pub fn zeros(&self) -> Vec<u8> {
        let mut zeros = [0; 16];
        let mut cipher = Aes128Ctr64BE::new(&self.aes_key.into(), &zeros.into());
        cipher.apply_keystream(&mut zeros);
        zeros.to_vec()
    }

    /// 加密流中的数据段
    /// 在 CTR 模式下，加密和解密操作相同
    ///
    /// # 参数
    /// - `stream_num`: 流编号，必须非零（安全检查）
    /// - `offset`: 流内的字节偏移量
    /// - `data`: 要加密/解密的数据
    pub fn segment(&self, stream_num: u64, offset: u64, data: &[u8]) -> Vec<u8> {
        assert_ne!(stream_num, 0, "stream number must be nonzero"); // 安全检查

        // 构造 IV：前 8 字节为流编号（大端序）
        let mut iv = [0; 16];
        iv[0..8].copy_from_slice(&stream_num.to_be_bytes());

        let mut cipher = Aes128Ctr64BE::new(&self.aes_key.into(), &iv.into());
        let mut buf = data.to_vec();

        // 定位到指定偏移量
        cipher.seek(offset);
        cipher.apply_keystream(&mut buf);

        buf
    }

    /// 生成指定长度的随机密钥，类似 sshx 的 rand_alphanumeric
    pub fn generate_key(length: usize) -> String {
        use rand::Rng;

        let mut rng = rand::rng();
        (0..length)
            .map(|_| {
                let chars = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
                chars[rng.random_range(0..chars.len())] as char
            })
            .collect()
    }

    /// 生成随机会话密钥，类似 sshx 的 rand_alphanumeric(14)
    pub fn generate_session_key() -> String {
        use rand::Rng;

        let mut rng = rand::rng();
        (0..14) // 83.3 bits of entropy
            .map(|_| {
                let chars = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
                chars[rng.random_range(0..chars.len())] as char
            })
            .collect()
    }

    /// 验证两个加密器是否使用相同密钥
    pub fn verify_key(&self, other: &Self) -> bool {
        self.zeros() == other.zeros()
    }
}

#[cfg(test)]
mod tests {
    use super::SessionEncrypt;

    #[test]
    fn test_encrypt_creation() {
        let encrypt = SessionEncrypt::new("test");
        // 验证与 sshx 相同的零块输出
        assert_eq!(
            encrypt.zeros(),
            [
                198, 3, 249, 238, 65, 10, 224, 98, 253, 73, 148, 1, 138, 3, 108, 143
            ],
        );
    }

    #[test]
    fn test_encryption_roundtrip() {
        let encrypt = SessionEncrypt::new("this is a test key");
        let data = b"hello world";
        let encrypted = encrypt.segment(1, 0, data);
        assert_eq!(encrypted.len(), data.len());
        let decrypted = encrypt.segment(1, 0, &encrypted);
        assert_eq!(decrypted, data);
    }

    #[test]
    fn test_offset_consistency() {
        let encrypt = SessionEncrypt::new("this is a test key");
        let data = b"1st block.(16B)|2nd block......|3rd block";
        let encrypted = encrypt.segment(1, 0, data);
        assert_eq!(encrypted.len(), data.len());

        // 验证偏移量加密的一致性
        for i in 1..data.len() {
            let encrypted_suffix = encrypt.segment(1, i as u64, &data[i..]);
            assert_eq!(encrypted_suffix, &encrypted[i..]);
        }
    }

    #[test]
    #[should_panic(expected = "stream number must be nonzero")]
    fn test_zero_stream_number() {
        let encrypt = SessionEncrypt::new("this is a test key");
        encrypt.segment(0, 0, b"hello world");
    }

    #[test]
    fn test_key_generation() {
        let key1 = SessionEncrypt::generate_session_key();
        let key2 = SessionEncrypt::generate_session_key();

        assert_eq!(key1.len(), 14);
        assert_eq!(key2.len(), 14);
        assert_ne!(key1, key2); // 应该生成不同的密钥

        // 验证只包含字母数字字符
        assert!(key1.chars().all(|c| c.is_alphanumeric()));
        assert!(key2.chars().all(|c| c.is_alphanumeric()));
    }

    #[test]
    fn test_key_verification() {
        let key = "test_key_123";
        let encrypt1 = SessionEncrypt::new(key);
        let encrypt2 = SessionEncrypt::new(key);
        let encrypt3 = SessionEncrypt::new("different_key");

        assert!(encrypt1.verify_key(&encrypt2));
        assert!(!encrypt1.verify_key(&encrypt3));
    }
}

