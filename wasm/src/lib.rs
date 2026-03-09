use png::{BitDepth, ColorType, Compression, Decoder, Encoder, Filter, Transformations};
use std::io::Cursor;

const HEADER_WORDS: usize = 8;
const HEADER_LEN: usize = HEADER_WORDS * 4;
const STATUS_OK: u32 = 0;
const STATUS_ERR: u32 = 1;

const FLAG_COLOR: u32 = 1 << 0;
const FLAG_ALPHA: u32 = 1 << 1;
const FLAG_PALETTE: u32 = 1 << 2;
const FLAG_INTERLACE: u32 = 1 << 3;

const COLORTYPE_GRAYSCALE: u32 = 0;
const COLORTYPE_COLOR: u32 = 2;
const COLORTYPE_PALETTE_COLOR: u32 = 3;
const COLORTYPE_ALPHA: u32 = 4;
const COLORTYPE_COLOR_ALPHA: u32 = 6;

struct DecodeResult {
    width: u32,
    height: u32,
    depth: u32,
    color_type: u32,
    flags: u32,
    gamma_scaled: u32,
    data: Vec<u8>,
}

fn write_u32(slice: &mut [u8], offset: usize, value: u32) {
    slice[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn pack_result(status: u32, fields: [u32; HEADER_WORDS - 2], payload: &[u8]) -> *mut u8 {
    let total_len = HEADER_LEN + payload.len();
    let mut out = vec![0_u8; total_len];

    write_u32(&mut out, 0, status);
    write_u32(&mut out, 4, fields[0]);
    write_u32(&mut out, 8, fields[1]);
    write_u32(&mut out, 12, fields[2]);
    write_u32(&mut out, 16, fields[3]);
    write_u32(&mut out, 20, fields[4]);
    write_u32(&mut out, 24, fields[5]);
    write_u32(&mut out, 28, payload.len() as u32);
    out[HEADER_LEN..].copy_from_slice(payload);

    leak_vec(out)
}

fn pack_error(message: impl Into<String>) -> *mut u8 {
    let text = message.into();
    pack_result(STATUS_ERR, [0, 0, 0, 0, 0, 0], text.as_bytes())
}

fn leak_vec(mut data: Vec<u8>) -> *mut u8 {
    let ptr = data.as_mut_ptr();
    std::mem::forget(data);
    ptr
}

fn clone_input(ptr: *const u8, len: u32) -> Result<Vec<u8>, String> {
    if ptr.is_null() {
        return Err("null input pointer".to_string());
    }

    let len = len as usize;
    // SAFETY: The caller provides a valid wasm memory pointer/length pair.
    let input = unsafe { std::slice::from_raw_parts(ptr, len) };
    Ok(input.to_vec())
}

fn extract_gamma_scaled(input: &[u8]) -> Result<u32, String> {
    if input.len() < 8 {
        return Ok(0);
    }

    let mut offset = 8_usize;
    let mut gamma_scaled = 0_u32;
    while offset + 12 <= input.len() {
        let length = u32::from_be_bytes([
            input[offset],
            input[offset + 1],
            input[offset + 2],
            input[offset + 3],
        ]) as usize;
        let type_offset = offset + 4;
        let data_offset = offset + 8;
        let chunk_end = data_offset.saturating_add(length);
        let next_offset = chunk_end.saturating_add(4);

        if next_offset > input.len() {
            return Ok(gamma_scaled);
        }

        let chunk_type = &input[type_offset..type_offset + 4];
        for &char_code in chunk_type {
            if char_code < 65 || char_code > 122 || (char_code > 90 && char_code < 97) {
                return Err("Invalid chunk type".to_string());
            }
        }

        if chunk_type == b"gAMA" && length == 4 {
            gamma_scaled = u32::from_be_bytes([
                input[data_offset],
                input[data_offset + 1],
                input[data_offset + 2],
                input[data_offset + 3],
            ]);
        }

        if chunk_type == b"IEND" {
            break;
        }

        offset = next_offset;
    }

    Ok(gamma_scaled)
}

fn bpp_for_color_type(color_type: ColorType) -> u32 {
    match color_type {
        ColorType::Grayscale => 1,
        ColorType::Rgb | ColorType::Indexed => 3,
        ColorType::GrayscaleAlpha => 2,
        ColorType::Rgba => 4,
    }
}

fn js_color_type(color_type: ColorType) -> u32 {
    match color_type {
        ColorType::Grayscale => COLORTYPE_GRAYSCALE,
        ColorType::Rgb => COLORTYPE_COLOR,
        ColorType::Indexed => COLORTYPE_PALETTE_COLOR,
        ColorType::GrayscaleAlpha => COLORTYPE_ALPHA,
        ColorType::Rgba => COLORTYPE_COLOR_ALPHA,
    }
}

fn depth_to_u32(bit_depth: BitDepth) -> u32 {
    match bit_depth {
        BitDepth::One => 1,
        BitDepth::Two => 2,
        BitDepth::Four => 4,
        BitDepth::Eight => 8,
        BitDepth::Sixteen => 16,
    }
}

fn normalize_to_rgba(bytes: &[u8], color_type: ColorType) -> Result<Vec<u8>, String> {
    match color_type {
        ColorType::Rgba => Ok(bytes.to_vec()),
        ColorType::Rgb => {
            let mut out = Vec::with_capacity((bytes.len() / 3) * 4);
            for chunk in bytes.chunks_exact(3) {
                out.extend_from_slice(&[chunk[0], chunk[1], chunk[2], 255]);
            }
            Ok(out)
        }
        ColorType::Grayscale => {
            let mut out = Vec::with_capacity(bytes.len() * 4);
            for &sample in bytes {
                out.extend_from_slice(&[sample, sample, sample, 255]);
            }
            Ok(out)
        }
        ColorType::GrayscaleAlpha => {
            let mut out = Vec::with_capacity((bytes.len() / 2) * 4);
            for chunk in bytes.chunks_exact(2) {
                out.extend_from_slice(&[chunk[0], chunk[0], chunk[0], chunk[1]]);
            }
            Ok(out)
        }
        ColorType::Indexed => {
            Err("indexed output should be expanded before normalization".to_string())
        }
    }
}

fn decode_png(input: &[u8], ignore_checksums: bool) -> Result<DecodeResult, String> {
    let gamma_scaled = extract_gamma_scaled(input)?;
    let cursor = Cursor::new(input);
    let mut decoder = Decoder::new(cursor);
    decoder.set_transformations(Transformations::EXPAND | Transformations::STRIP_16);
    decoder.ignore_checksums(ignore_checksums);

    let mut reader = decoder
        .read_info()
        .map_err(|err| format!("decode error: {err}"))?;
    let info = reader.info();
    let width = info.width;
    let height = info.height;
    let depth = depth_to_u32(info.bit_depth);
    let color_type = info.color_type;
    let has_trns = info.trns.is_some();
    let flags = (u32::from(!matches!(
        color_type,
        ColorType::Grayscale | ColorType::GrayscaleAlpha
    )) * FLAG_COLOR)
        | (u32::from(matches!(color_type, ColorType::Indexed)) * FLAG_PALETTE)
        | (u32::from(
            matches!(color_type, ColorType::Rgba | ColorType::GrayscaleAlpha) || has_trns,
        ) * FLAG_ALPHA)
        | (u32::from(info.interlaced) * FLAG_INTERLACE);

    let output_buffer_size = reader
        .output_buffer_size()
        .ok_or_else(|| "decode error: unknown output buffer size".to_string())?;
    let mut buf = vec![0_u8; output_buffer_size];
    let output_info = reader
        .next_frame(&mut buf)
        .map_err(|err| format!("decode error: {err}"))?;
    let data = normalize_to_rgba(&buf[..output_info.buffer_size()], output_info.color_type)?;

    Ok(DecodeResult {
        width,
        height,
        depth,
        color_type: js_color_type(color_type),
        flags,
        gamma_scaled,
        data,
    })
}

fn as_bit_depth(bit_depth: u32) -> Result<BitDepth, String> {
    match bit_depth {
        8 => Ok(BitDepth::Eight),
        16 => Ok(BitDepth::Sixteen),
        other => Err(format!("unsupported bit depth {other}")),
    }
}

fn as_color_type(color_type: u32) -> Result<ColorType, String> {
    match color_type {
        COLORTYPE_GRAYSCALE => Ok(ColorType::Grayscale),
        COLORTYPE_COLOR => Ok(ColorType::Rgb),
        COLORTYPE_ALPHA => Ok(ColorType::GrayscaleAlpha),
        COLORTYPE_COLOR_ALPHA => Ok(ColorType::Rgba),
        other => Err(format!("unsupported color type {other}")),
    }
}

fn bytes_per_pixel(color_type: u32, bit_depth: u32) -> Result<usize, String> {
    let samples = match color_type {
        COLORTYPE_GRAYSCALE => 1,
        COLORTYPE_COLOR => 3,
        COLORTYPE_ALPHA => 2,
        COLORTYPE_COLOR_ALPHA => 4,
        other => return Err(format!("unsupported color type {other}")),
    };
    let bytes_per_sample = match bit_depth {
        8 => 1,
        16 => 2,
        other => return Err(format!("unsupported bit depth {other}")),
    };

    Ok(samples * bytes_per_sample)
}

fn clamp_round(value: f32, max_value: f32) -> u16 {
    if value <= 0.0 {
        return 0;
    }
    if value >= max_value {
        return max_value as u16;
    }
    value.round() as u16
}

fn read_sample(data: &[u8], offset: usize, bit_depth: u32) -> u16 {
    match bit_depth {
        8 => data[offset] as u16,
        16 => u16::from_le_bytes([data[offset], data[offset + 1]]),
        _ => unreachable!(),
    }
}

fn write_sample(out: &mut Vec<u8>, sample: u16, bit_depth: u32) {
    match bit_depth {
        8 => out.push(sample as u8),
        16 => out.extend_from_slice(&sample.to_be_bytes()),
        _ => unreachable!(),
    }
}

fn convert_pixels(
    data: &[u8],
    width: u32,
    height: u32,
    bit_depth: u32,
    input_color_type: u32,
    input_has_alpha: bool,
    output_color_type: u32,
    bg: [u16; 3],
) -> Result<Vec<u8>, String> {
    let in_bpp = bytes_per_pixel(input_color_type, bit_depth)?;
    let out_bpp = bytes_per_pixel(output_color_type, bit_depth)?;
    let expected_len = width as usize * height as usize * in_bpp;
    if data.len() != expected_len {
        return Err(format!(
            "input data length mismatch: expected {expected_len}, got {}",
            data.len()
        ));
    }

    let max_value = if bit_depth == 16 { 65535.0 } else { 255.0 };
    let mut out = Vec::with_capacity(width as usize * height as usize * out_bpp);

    for pixel in data.chunks_exact(in_bpp) {
        let (mut red, mut green, mut blue, alpha) = match input_color_type {
            COLORTYPE_COLOR_ALPHA => (
                read_sample(pixel, 0, bit_depth),
                read_sample(pixel, if bit_depth == 8 { 1 } else { 2 }, bit_depth),
                read_sample(pixel, if bit_depth == 8 { 2 } else { 4 }, bit_depth),
                read_sample(pixel, if bit_depth == 8 { 3 } else { 6 }, bit_depth),
            ),
            COLORTYPE_COLOR => (
                read_sample(pixel, 0, bit_depth),
                read_sample(pixel, if bit_depth == 8 { 1 } else { 2 }, bit_depth),
                read_sample(pixel, if bit_depth == 8 { 2 } else { 4 }, bit_depth),
                max_value as u16,
            ),
            COLORTYPE_ALPHA => {
                let gray = read_sample(pixel, 0, bit_depth);
                let alpha = read_sample(pixel, if bit_depth == 8 { 1 } else { 2 }, bit_depth);
                (gray, gray, gray, alpha)
            }
            COLORTYPE_GRAYSCALE => {
                let gray = read_sample(pixel, 0, bit_depth);
                (gray, gray, gray, max_value as u16)
            }
            other => return Err(format!("unsupported input color type {other}")),
        };

        let output_has_alpha =
            output_color_type == COLORTYPE_COLOR_ALPHA || output_color_type == COLORTYPE_ALPHA;

        if input_has_alpha && !output_has_alpha {
            let alpha_ratio = alpha as f32 / max_value;
            red = clamp_round(
                (1.0 - alpha_ratio) * bg[0] as f32 + alpha_ratio * red as f32,
                max_value,
            );
            green = clamp_round(
                (1.0 - alpha_ratio) * bg[1] as f32 + alpha_ratio * green as f32,
                max_value,
            );
            blue = clamp_round(
                (1.0 - alpha_ratio) * bg[2] as f32 + alpha_ratio * blue as f32,
                max_value,
            );
        }

        match output_color_type {
            COLORTYPE_COLOR_ALPHA | COLORTYPE_COLOR => {
                write_sample(&mut out, red, bit_depth);
                write_sample(&mut out, green, bit_depth);
                write_sample(&mut out, blue, bit_depth);
                if output_has_alpha {
                    write_sample(&mut out, alpha, bit_depth);
                }
            }
            COLORTYPE_ALPHA | COLORTYPE_GRAYSCALE => {
                let gray = ((red as u32 + green as u32 + blue as u32) / 3) as u16;
                write_sample(&mut out, gray, bit_depth);
                if output_has_alpha {
                    write_sample(&mut out, alpha, bit_depth);
                }
            }
            other => return Err(format!("unsupported output color type {other}")),
        }
    }

    Ok(out)
}

fn compression_from_level(level: u32) -> Compression {
    match level {
        0..=3 => Compression::Fast,
        4..=6 => Compression::Balanced,
        _ => Compression::High,
    }
}

fn filter_from_value(value: u32) -> Filter {
    match value {
        0 => Filter::NoFilter,
        1 => Filter::Sub,
        2 => Filter::Up,
        3 => Filter::Avg,
        4 => Filter::Paeth,
        _ => Filter::Adaptive,
    }
}

struct EncodeOptions {
    width: u32,
    height: u32,
    gamma_scaled: u32,
    color_type: u32,
    bit_depth: u32,
    input_color_type: u32,
    input_has_alpha: bool,
    bg: [u16; 3],
    compression_level: u32,
    filter: u32,
}

fn encode_png(data: &[u8], options: &EncodeOptions) -> Result<Vec<u8>, String> {
    let converted = convert_pixels(
        data,
        options.width,
        options.height,
        options.bit_depth,
        options.input_color_type,
        options.input_has_alpha,
        options.color_type,
        options.bg,
    )?;

    let mut out = Vec::new();
    let mut encoder = Encoder::new(&mut out, options.width, options.height);
    encoder.set_color(as_color_type(options.color_type)?);
    encoder.set_depth(as_bit_depth(options.bit_depth)?);
    encoder.set_compression(compression_from_level(options.compression_level));
    encoder.set_filter(filter_from_value(options.filter));

    let mut writer = encoder
        .write_header()
        .map_err(|err| format!("encode error: {err}"))?;

    if options.gamma_scaled != 0 {
        writer
            .write_chunk(png::chunk::gAMA, &options.gamma_scaled.to_be_bytes())
            .map_err(|err| format!("encode error: {err}"))?;
    }

    writer
        .write_image_data(&converted)
        .map_err(|err| format!("encode error: {err}"))?;

    drop(writer);
    Ok(out)
}

#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: u32) -> *mut u8 {
    leak_vec(vec![0_u8; len as usize])
}

#[unsafe(no_mangle)]
pub extern "C" fn dealloc(ptr: *mut u8, len: u32) {
    if ptr.is_null() {
        return;
    }

    // SAFETY: The pointer was returned by `alloc`/`pack_result` with capacity == len.
    unsafe {
        drop(Vec::from_raw_parts(ptr, len as usize, len as usize));
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn png_sync_read(ptr: *const u8, len: u32, ignore_checksums: u32) -> *mut u8 {
    let input = match clone_input(ptr, len) {
        Ok(input) => input,
        Err(err) => return pack_error(err),
    };

    match decode_png(&input, ignore_checksums != 0) {
        Ok(decoded) => {
            let bpp = bpp_for_color_type(match decoded.color_type {
                COLORTYPE_GRAYSCALE => ColorType::Grayscale,
                COLORTYPE_COLOR => ColorType::Rgb,
                COLORTYPE_PALETTE_COLOR => ColorType::Indexed,
                COLORTYPE_ALPHA => ColorType::GrayscaleAlpha,
                COLORTYPE_COLOR_ALPHA => ColorType::Rgba,
                _ => ColorType::Rgba,
            });

            pack_result(
                STATUS_OK,
                [
                    decoded.width,
                    decoded.height,
                    decoded.depth,
                    decoded.color_type,
                    decoded.flags,
                    (decoded.gamma_scaled & 0xffff_ffff) | (bpp << 24),
                ],
                &decoded.data,
            )
        }
        Err(err) => pack_error(err),
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn png_sync_write(
    data_ptr: *const u8,
    data_len: u32,
    width: u32,
    height: u32,
    gamma_scaled: u32,
    color_type: u32,
    bit_depth: u32,
    input_color_type: u32,
    input_has_alpha: u32,
    bg_red: u32,
    bg_green: u32,
    bg_blue: u32,
    compression_level: u32,
    filter: u32,
) -> *mut u8 {
    let data = match clone_input(data_ptr, data_len) {
        Ok(data) => data,
        Err(err) => return pack_error(err),
    };

    let options = EncodeOptions {
        width,
        height,
        gamma_scaled,
        color_type,
        bit_depth,
        input_color_type,
        input_has_alpha: input_has_alpha != 0,
        bg: [bg_red as u16, bg_green as u16, bg_blue as u16],
        compression_level,
        filter,
    };

    match encode_png(&data, &options) {
        Ok(output) => pack_result(STATUS_OK, [0, 0, 0, 0, 0, 0], &output),
        Err(err) => pack_error(err),
    }
}
