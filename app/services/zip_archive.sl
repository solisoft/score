# A zip file made on the server, for "Export all my data": Soli has no zip
# builtin, so this writes one, its files stored as they are (no
# compression: a score's LilyPond is small, and every unzip reads "stored").
# Names are UTF-8 (flag bit 11), each file's CRC-32 is computed here.
#
# Soli has no bitwise operators, so the CRC is arithmetic on Ints: the
# functions below are typed Int end to end, which compiles them to machine
# code (docs/native-kernels.md): about 0.4 s a megabyte, where the same
# loop interpreted takes several seconds. They are free functions because
# only a top-level `def` is compiled; the `zip_` names are this file's.

# `a` xor `b`, both below 2 × `top` (a power of two): bit by bit, from the
# highest, by comparison — no division in the loop.
def zip_xor(a: Int, b: Int, top: Int) -> Int
  result = 0
  bit = top
  while bit > 0
    in_a = a >= bit
    in_b = b >= bit
    a -= bit if in_a
    b -= bit if in_b
    result += bit if in_a != in_b
    bit = bit / 2
  end
  result
end

# The CRC-32 table (polynomial 0xEDB88320) for a nibble: 16 entries.
def zip_crc_nibble_table(n: Int) -> Int
  if n < 8
    if n < 4
      return 0 if n == 0
      return 498536548 if n == 1
      return 997073096 if n == 2

      return 651767980
    end
    return 1994146192 if n == 4
    return 1802195444 if n == 5
    return 1303535960 if n == 6

    return 1342533948
  end
  if n < 12
    return 3988292384 if n == 8
    return 4027552580 if n == 9
    return 3604390888 if n == 10

    return 3412177804
  end
  return 2607071920 if n == 12
  return 2262029012 if n == 13
  return 2685067896 if n == 14

  3183342108
end

def zip_crc_nibble(crc: Int, nibble: Int) -> Int
  slot = zip_xor(crc % 16, nibble, 8)
  zip_xor(zip_crc_nibble_table(slot), crc / 16, 2147483648)
end

# One byte into the running CRC.
def zip_crc_byte(crc: Int, byte: Int) -> Int
  zip_crc_nibble(zip_crc_nibble(crc, byte % 16), byte / 16)
end

# Eight bytes at a time: one call from the interpreter for eight.
def zip_crc_eight(crc: Int, b0: Int, b1: Int, b2: Int, b3: Int, b4: Int, b5: Int, b6: Int, b7: Int) -> Int
  running = zip_crc_byte(crc, b0)
  running = zip_crc_byte(running, b1)
  running = zip_crc_byte(running, b2)
  running = zip_crc_byte(running, b3)
  running = zip_crc_byte(running, b4)
  running = zip_crc_byte(running, b5)
  running = zip_crc_byte(running, b6)
  zip_crc_byte(running, b7)
end

const ZIP_MAX_ENTRIES = 65535
const ZIP_MAX_BYTES = 4294967295

class ZipArchive
  # The zip of `files` ([{"name", "text"}], the text written as UTF-8), as
  # bytes: what a response's body sends as they are. `at` (unix seconds) is
  # the time every file is dated. Raises past the plain zip format's limits
  # (65 535 files, 4 GB), which an account cannot reach.
  static def build(files, at)
    throw "A zip holds at most #{ZIP_MAX_ENTRIES} files" if files.length > ZIP_MAX_ENTRIES

    stamp = ZipArchive.dos_stamp(at)
    out = []
    directory = []
    files.each do |file|
      name = Encoding.encode(file["name"].to_s, "utf-8")
      data = Encoding.encode(file["text"].to_s, "utf-8")
      crc = ZipArchive.crc32(data)
      offset = out.length
      # Local file header: version 2.0, UTF-8 names, stored.
      out.concat([80, 75, 3, 4, 20, 0, 0, 8, 0, 0])
      out.concat(stamp)
      out.concat(ZipArchive.u32(crc))
      out.concat(ZipArchive.u32(data.length))
      out.concat(ZipArchive.u32(data.length))
      out.concat(ZipArchive.u16(name.length))
      out.concat([0, 0])
      out.concat(name)
      out.concat(data)
      # Its entry in the central directory.
      directory.concat([
        80,
        75,
        1,
        2,
        20,
        0,
        20,
        0,
        0,
        8,
        0,
        0
      ])
      directory.concat(stamp)
      directory.concat(ZipArchive.u32(crc))
      directory.concat(ZipArchive.u32(data.length))
      directory.concat(ZipArchive.u32(data.length))
      directory.concat(ZipArchive.u16(name.length))
      directory.concat([
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ])
      directory.concat(ZipArchive.u32(offset))
      directory.concat(name)
    end
    throw "A zip holds at most 4 GB" if out.length + directory.length > ZIP_MAX_BYTES

    start = out.length
    out.concat(directory)
    # End of central directory.
    out.concat([80, 75, 5, 6, 0, 0, 0, 0])
    out.concat(ZipArchive.u16(files.length))
    out.concat(ZipArchive.u16(files.length))
    out.concat(ZipArchive.u32(directory.length))
    out.concat(ZipArchive.u32(start))
    out.concat([0, 0])
    out
  end

  # The CRC-32 of `bytes` (an array of Ints 0–255), as zip and gzip use it.
  static def crc32(bytes)
    crc = 4294967295
    count = bytes.length
    whole = count - count % 8
    i = 0
    while i < whole
      crc = zip_crc_eight(
        crc,
        bytes[i],
        bytes[i + 1],
        bytes[i + 2],
        bytes[i + 3],
        bytes[i + 4],
        bytes[i + 5],
        bytes[i + 6],
        bytes[i + 7]
      )
      i += 8
    end
    while i < count
      crc = zip_crc_byte(crc, bytes[i])
      i += 1
    end
    4294967295 - crc
  end

  # `at` as the four bytes of an MS-DOS time and date, in UTC: two-second
  # steps, years from 1980.
  static def dos_stamp(at)

    # Read from the ISO text, which is in UTC (`hour` is the server's local).
    iso = DateTime.from_unix(at).to_iso
    part = fn(first, last) { iso.substring(first, last).to_i }
    time = part(11, 13) * 2048 + part(14, 16) * 32 + part(17, 19) / 2
    date = ([part(0, 4), 1980].max() - 1980) * 512 + part(5, 7) * 32 + part(8, 10)
    ZipArchive.u16(time) + ZipArchive.u16(date)
  end

  # Little-endian, as zip writes its numbers.
  static def u16(value)
    [value % 256, value / 256 % 256]
  end

  static def u32(value)
    [value % 256, value / 256 % 256, value / 65536 % 256, value / 16777216 % 256]
  end
end
