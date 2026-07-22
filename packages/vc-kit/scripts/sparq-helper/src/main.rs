//! sm-5ogg vc-kit phase - seed-time bridge into sparq's native
//! `encode_int_literal` (Tier A `kyb:ownershipPercentageBps` operand
//! anchors). Reads ONE job document (JSON) from stdin, writes ONE result
//! document (JSON) to stdout.
//!
//! NOT BUILT OR RUN IN THIS ENVIRONMENT: this sandbox has no local sparq
//! checkout. This source mirrors the mortgage/lending showcases' own
//! `scripts/sparq-helper/src/main.rs` (same `encodeInts` capability,
//! trimmed of the dual-sign/composite capabilities this package's Tier B
//! circuit does not need), so a future session WITH `SPARQ_CHECKOUT`
//! access can build and run it unmodified.
//!
//! HONESTY: the sparq ZK estate is research-grade and NOT externally
//! audited (sparq bead sq-qhy4).

use std::collections::BTreeMap;
use std::io::Read;

use serde::{Deserialize, Serialize};
use sparq_zk_compose::build::encode_int_literal;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Job {
    /// `xsd:integer` values to encode (`operand_enc` per `kyb:ownershipPercentageBps`).
    #[serde(default)]
    encode_ints: Vec<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Output {
    /// value (decimal string) -> operand_enc (0x hex).
    encodings: BTreeMap<String, String>,
}

fn fail(msg: &str) -> ! {
    eprintln!("[kyb-sparq-seed-helper] {msg}");
    std::process::exit(1);
}

fn main() {
    let mut raw = String::new();
    if std::io::stdin().read_to_string(&mut raw).is_err() {
        fail("could not read the job document from stdin");
    }
    let job: Job = match serde_json::from_str(&raw) {
        Ok(job) => job,
        Err(e) => fail(&format!("job document is not valid JSON: {e}")),
    };

    let mut encodings = BTreeMap::new();
    for value in &job.encode_ints {
        let enc = encode_int_literal(*value);
        encodings.insert(value.to_string(), enc.0);
    }

    let output = Output { encodings };
    match serde_json::to_string_pretty(&output) {
        Ok(body) => println!("{body}"),
        Err(e) => fail(&format!("could not serialise the result: {e}")),
    }
}
