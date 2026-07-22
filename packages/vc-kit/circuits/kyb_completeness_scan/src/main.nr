fn main(
    challenge: pub Field,
    array_commitment: pub Field,
    threshold: pub u64,
    disclosed_count: pub u32,
    expected: pub bool,
    bps: [u64; 8],
) {
    let mut bytes: [u8; 64] = [0; 64];
    for i in 0..8 {
        let b: [u8; 8] = (bps[i] as Field).to_be_bytes();
        for j in 0..8 {
            bytes[i * 8 + j] = b[j];
        }
    }
    let digest: [u8; 32] = std::hash::blake3(bytes);
    let mut acc: Field = 0;
    for i in 0..31 {
        acc = acc * 256 + digest[i] as Field;
    }
    assert(acc == array_commitment, "array commitment mismatch");

    let mut count: u32 = 0;
    for i in 0..8 {
        let above = (bps[i] >= threshold) as u32;
        count = count + above;
    }
    assert(count == disclosed_count, "completeness count mismatch");
    assert(expected == true, "verdict mismatch");

    let _unused = challenge;
}
