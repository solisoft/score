# ZipArchive: the zip "Export all my data" downloads, written on the server.
# Read back here by a small reader of the format, which checks what any
# unzip checks: the signatures, the offsets, the sizes and each CRC-32.

# A little-endian number of `count` bytes at `at`.
def zip_spec_number(bytes, at, count)
  value = 0
  scale = 1
  (0 .. count).each do |i|
    value = value + bytes[at + i] * scale
    scale = scale * 256
  end
  value
end

# The files of the zip `bytes`, read from its central directory and checked
# against their local headers: [{"name", "text", "crc", "flags", "method"}].
def zip_spec_read(bytes)
  end_at = bytes.length - 22
  assert_eq(bytes.slice(end_at, end_at + 4), [
    80,
    75,
    5,
    6
  ], "the end of the central directory")
  count = zip_spec_number(bytes, end_at + 10, 2)
  at = zip_spec_number(bytes, end_at + 16, 4)
  files = []
  (0 .. count).each do |_|
    assert_eq(bytes.slice(at, at + 4), [
      80,
      75,
      1,
      2
    ], "a central directory entry")
    name_length = zip_spec_number(bytes, at + 28, 2)
    size = zip_spec_number(bytes, at + 20, 4)
    local = zip_spec_number(bytes, at + 42, 4)
    assert_eq(bytes.slice(local, local + 4), [
      80,
      75,
      3,
      4
    ], "its local header")
    assert_eq(zip_spec_number(bytes, local + 18, 4), size, "the size in both headers")
    data_at = local + 30 + zip_spec_number(bytes, local + 26, 2)
    data = bytes.slice(data_at, data_at + size)
    files.push({
      "name": Encoding.decode(bytes.slice(at + 46, at + 46 + name_length), "utf-8"),
      "text": Encoding.decode(data, "utf-8"),
      "crc": zip_spec_number(bytes, at + 16, 4),
      "real_crc": ZipArchive.crc32(data),
      "flags": zip_spec_number(bytes, at + 8, 2),
      "method": zip_spec_number(bytes, at + 10, 2)
    })
    at = at + 46 + name_length
  end
  files
end

describe("ZipArchive") do
  describe("crc32") do
    test("is the CRC-32 every zip reader checks: known values") do
      quick = Encoding.encode("The quick brown fox jumps over the lazy dog", "utf-8")
      assert_eq(ZipArchive.crc32(quick), 1095738169)
      assert_eq(ZipArchive.crc32([]), 0)
      assert_eq(ZipArchive.crc32([97]), 3904355907)
      assert_eq(ZipArchive.crc32(Encoding.encode("123456789", "utf-8")), 3421780262)
    end

    test("reads every byte: one changed, at the end or in the middle, changes it") do
      text = Encoding.encode("abcdefghijklmnopq", "utf-8")
      base = ZipArchive.crc32(text)
      last = Encoding.encode("abcdefghijklmnopr", "utf-8")
      middle = Encoding.encode("abcdefgHijklmnopq", "utf-8")
      assert_ne(ZipArchive.crc32(last), base)
      assert_ne(ZipArchive.crc32(middle), base)
    end
  end

  describe("build") do
    test("writes stored files whose names, texts and CRCs read back") do
      files = [
        {"name": "README.txt", "text": "Hello"},
        {"name": "scores/chorale-é/chorale-é.ly", "text": "\\header { title = \"Chorale é\" }\n{ c'4 d' }"},
        {"name": "empty.txt", "text": ""}
      ]
      read = zip_spec_read(ZipArchive.build(files, 1792700073))
      assert_eq(read.map(&:name), [
        "README.txt",
        "scores/chorale-é/chorale-é.ly",
        "empty.txt"
      ])
      assert_eq(read.map(&:text), [
        "Hello",
        "\\header { title = \"Chorale é\" }\n{ c'4 d' }",
        ""
      ])
      read.each do |file|
        assert_eq(file["crc"], file["real_crc"], file["name"])
        assert_eq(file["method"], 0, "stored")
        assert_eq(file["flags"], 2048, "UTF-8 names")
      end
    end

    test("an empty zip is just its end record") do
      bytes = ZipArchive.build([], 1792700073)
      assert_eq(bytes.length, 22)
      assert_eq(zip_spec_read(bytes), [])
    end

    test("refuses more files than a plain zip holds, before writing any") do
      too_many = (0 .. ZIP_MAX_ENTRIES + 1).map do |i|
        {"name": "f", "text": ""}
      end
      assert_raises("at most 65535 files") do
        ZipArchive.build(too_many, 1792700073)
      end
    end
  end

  describe("dos_stamp") do
    test("dates the files in MS-DOS time, in UTC") do
      # 2026-10-22 20:14:33 UTC: 20:14:32 in two-second steps.
      stamp = ZipArchive.dos_stamp(1792700073)
      time = stamp[0] + stamp[1] * 256
      date = stamp[2] + stamp[3] * 256
      assert_eq(time, 20 * 2048 + 14 * 32 + 16)
      assert_eq(date, (2026 - 1980) * 512 + 10 * 32 + 22)
    end

    test("a time before 1980 is dated 1980, the format's first year") do
      stamp = ZipArchive.dos_stamp(0)
      assert_eq((stamp[2] + stamp[3] * 256) / 512, 0)
    end
  end

  test("numbers are little-endian") do
    assert_eq(ZipArchive.u16(258), [2, 1])
    assert_eq(ZipArchive.u32(4294967295), [
      255,
      255,
      255,
      255
    ])
    assert_eq(ZipArchive.u32(16909060), [
      4,
      3,
      2,
      1
    ])
  end
end
