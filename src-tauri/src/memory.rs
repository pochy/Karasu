/// OS へのヒープ返却を促す（macOS のみ。他 OS は no-op）。
pub fn trim_process_heap() {
    trim_process_heap_impl();
}

#[cfg(target_os = "macos")]
fn trim_process_heap_impl() {
    extern "C" {
        fn malloc_zone_pressure_relief(zone: *mut std::ffi::c_void, goal: usize) -> usize;
    }
    unsafe {
        malloc_zone_pressure_relief(std::ptr::null_mut(), 0);
    }
}

#[cfg(not(target_os = "macos"))]
fn trim_process_heap_impl() {}
