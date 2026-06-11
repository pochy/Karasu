/// Quote-aware CSV byte scanner (RFC 4180-ish).

pub fn strip_bom(data: &[u8]) -> &[u8] {
    if data.starts_with(&[0xEF, 0xBB, 0xBF]) {
        &data[3..]
    } else {
        data
    }
}

/// Returns the byte index after the record terminator (exclusive end).
pub fn record_end(data: &[u8], start: usize) -> Option<usize> {
    if start >= data.len() {
        return None;
    }
    let mut in_quotes = false;
    let mut i = start;
    while i < data.len() {
        let b = data[i];
        if in_quotes {
            if b == b'"' {
                if i + 1 < data.len() && data[i + 1] == b'"' {
                    i += 2;
                    continue;
                }
                in_quotes = false;
            }
            i += 1;
            continue;
        }
        match b {
            b'"' => {
                in_quotes = true;
                i += 1;
            }
            b'\n' => return Some(i + 1),
            b'\r' => {
                if i + 1 < data.len() && data[i + 1] == b'\n' {
                    return Some(i + 2);
                }
                return Some(i + 1);
            }
            _ => i += 1,
        }
    }
    Some(data.len())
}

pub fn parse_fields(record: &[u8]) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = Vec::new();
    let mut in_quotes = false;
    let mut i = 0;
    while i < record.len() {
        let b = record[i];
        if in_quotes {
            if b == b'"' {
                if i + 1 < record.len() && record[i + 1] == b'"' {
                    current.push(b'"');
                    i += 2;
                    continue;
                }
                in_quotes = false;
                i += 1;
                continue;
            }
            current.push(b);
            i += 1;
            continue;
        }
        match b {
            b'"' => {
                in_quotes = true;
                i += 1;
            }
            b',' => {
                fields.push(String::from_utf8_lossy(&current).into_owned());
                current.clear();
                i += 1;
            }
            _ => {
                current.push(b);
                i += 1;
            }
        }
    }
    fields.push(String::from_utf8_lossy(&current).into_owned());
    fields
}

pub fn serialize_fields(fields: &[String]) -> String {
    let mut out = String::new();
    for (idx, field) in fields.iter().enumerate() {
        if idx > 0 {
            out.push(',');
        }
        let needs_quote = field.contains(',')
            || field.contains('"')
            || field.contains('\n')
            || field.contains('\r');
        if needs_quote {
            out.push('"');
            for ch in field.chars() {
                if ch == '"' {
                    out.push('"');
                }
                out.push(ch);
            }
            out.push('"');
        } else {
            out.push_str(field);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_quoted_commas() {
        let row = br#""a,b",c"#;
        assert_eq!(parse_fields(row), vec!["a,b", "c"]);
    }

    #[test]
    fn parses_escaped_quotes() {
        let row = br#""a""b",c"#;
        assert_eq!(parse_fields(row), vec!["a\"b", "c"]);
    }

    #[test]
    fn record_end_respects_quotes() {
        let data = b"a,b\n\"x\ny\",z\n";
        assert_eq!(record_end(data, 0), Some(4));
        assert_eq!(record_end(data, 4), Some(12));
    }
}
