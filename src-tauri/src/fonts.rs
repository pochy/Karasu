use fontdb::Database;
use std::collections::BTreeSet;

/// システムにインストールされたフォントファミリー名を列挙する。
pub fn list_system_font_families(mono_only: bool) -> Vec<String> {
    let mut db = Database::new();
    db.load_system_fonts();

    let mut families = BTreeSet::new();
    for face in db.faces() {
        if mono_only && !face.monospaced {
            continue;
        }
        for (name, _) in &face.families {
            families.insert(name.clone());
        }
    }

    families.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_is_sorted_and_non_empty_on_typical_system() {
        let all = list_system_font_families(false);
        assert!(!all.is_empty());
        let sorted = all.clone();
        let mut check = sorted;
        check.sort();
        assert_eq!(all, check);
    }
}
