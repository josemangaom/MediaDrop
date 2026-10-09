(() => {
  'use strict';

  // Lightweight MPEG-TS (H.264 + AAC) -> fragmented MP4 transmuxer.
  // Written for MediaDrop. This does not decode/re-encode media; it repackages
  // the encoded H.264/AAC elementary streams into ISO-BMFF/fMP4.

  const TS_PACKET_SIZE = 188;
  const VIDEO_STREAM_TYPE_H264 = 0x1b;
  const AUDIO_STREAM_TYPE_AAC = 0x0f;
  const PTS_TIMESCALE = 90000;

  const u8 = (...values) => new Uint8Array(values);

  function concatArrays(arrays) {
    const filtered = arrays.filter((value) => value && value.byteLength);
    const size = filtered.reduce((sum, value) => sum + value.byteLength, 0);
    const out = new Uint8Array(size);
    let offset = 0;
    for (const value of filtered) {
      out.set(value, offset);
      offset += value.byteLength;
    }
    return out;
  }

  function ascii(value) {
    return new Uint8Array([...String(value)].map((char) => char.charCodeAt(0) & 0xff));
  }

  function uint16(value) {
    return u8((value >>> 8) & 0xff, value & 0xff);
  }

  function uint24(value) {
    return u8((value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
  }

  function uint32(value) {
    const number = Number(value) >>> 0;
    return u8(
      (number >>> 24) & 0xff,
      (number >>> 16) & 0xff,
      (number >>> 8) & 0xff,
      number & 0xff
    );
  }

  function int32(value) {
    return uint32(value >>> 0);
  }

  function uint64(value) {
    let bigint = BigInt(Math.max(0, Math.floor(Number(value) || 0)));
    const out = new Uint8Array(8);
    for (let index = 7; index >= 0; index -= 1) {
      out[index] = Number(bigint & 0xffn);
      bigint >>= 8n;
    }
    return out;
  }

  function fixed16_16(value) {
    return uint32(Math.max(0, Math.round(Number(value || 0) * 65536)));
  }

  function fixed8_8(value) {
    return uint16(Math.max(0, Math.round(Number(value || 0) * 256)));
  }

  function box(type, ...payloads) {
    const payload = concatArrays(payloads);
    return concatArrays([uint32(payload.byteLength + 8), ascii(type), payload]);
  }

  function fullBox(type, version, flags, ...payloads) {
    return box(type, u8(version & 0xff), uint24(flags >>> 0), ...payloads);
  }

  function descriptorLength(length) {
    // MPEG-4 systems descriptor length, max 4 bytes.
    const bytes = [length & 0x7f];
    let remaining = length >>> 7;
    while (remaining) {
      bytes.unshift((remaining & 0x7f) | 0x80);
      remaining >>>= 7;
    }
    return new Uint8Array(bytes);
  }

  function descriptor(tag, payload) {
    return concatArrays([u8(tag), descriptorLength(payload.byteLength), payload]);
  }

  function parsePts(bytes, offset) {
    if (offset + 4 >= bytes.length) return null;
    // 0010/0011 ppp1 ppp... encoded 33-bit PTS/DTS.
    return (
      ((bytes[offset] & 0x0e) * 536870912) +
      (bytes[offset + 1] << 22) +
      ((bytes[offset + 2] & 0xfe) << 14) +
      (bytes[offset + 3] << 7) +
      ((bytes[offset + 4] & 0xfe) >>> 1)
    );
  }

  function unwrapTimestamp(value, reference) {
    if (!Number.isFinite(value)) return value;
    if (!Number.isFinite(reference)) return value;
    const wrap = 8589934592; // 2^33
    let adjusted = value;
    while (adjusted - reference > wrap / 2) adjusted -= wrap;
    while (reference - adjusted > wrap / 2) adjusted += wrap;
    return adjusted;
  }

  class BitReader {
    constructor(bytes) {
      this.bytes = bytes;
      this.bitPosition = 0;
    }

    readBit() {
      const byteIndex = this.bitPosition >>> 3;
      if (byteIndex >= this.bytes.length) return 0;
      const shift = 7 - (this.bitPosition & 7);
      this.bitPosition += 1;
      return (this.bytes[byteIndex] >>> shift) & 1;
    }

    readBits(count) {
      let value = 0;
      for (let index = 0; index < count; index += 1) {
        value = (value * 2) + this.readBit();
      }
      return value;
    }

    readUE() {
      let zeros = 0;
      while (zeros < 32 && this.readBit() === 0) zeros += 1;
      if (zeros === 0) return 0;
      return (2 ** zeros - 1) + this.readBits(zeros);
    }

    readSE() {
      const codeNum = this.readUE();
      const value = Math.ceil(codeNum / 2);
      return codeNum % 2 === 0 ? -value : value;
    }
  }

  function discardEmulationPrevention(bytes) {
    const out = [];
    for (let index = 0; index < bytes.length; index += 1) {
      if (
        index >= 2 &&
        bytes[index] === 0x03 &&
        bytes[index - 1] === 0x00 &&
        bytes[index - 2] === 0x00
      ) {
        continue;
      }
      out.push(bytes[index]);
    }
    return new Uint8Array(out);
  }

  function skipScalingList(reader, count) {
    let lastScale = 8;
    let nextScale = 8;
    for (let index = 0; index < count; index += 1) {
      if (nextScale !== 0) {
        const deltaScale = reader.readSE();
        nextScale = (lastScale + deltaScale + 256) % 256;
      }
      lastScale = nextScale === 0 ? lastScale : nextScale;
    }
  }

  function parseSps(sps) {
    if (!sps || sps.length < 4) return null;
    const rbsp = discardEmulationPrevention(sps.subarray(1));
    const reader = new BitReader(rbsp);

    const profileIdc = reader.readBits(8);
    const profileCompat = reader.readBits(8);
    const levelIdc = reader.readBits(8);
    reader.readUE(); // seq_parameter_set_id

    let chromaFormatIdc = 1;
    if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profileIdc)) {
      chromaFormatIdc = reader.readUE();
      if (chromaFormatIdc === 3) reader.readBit(); // separate_colour_plane_flag
      reader.readUE(); // bit_depth_luma_minus8
      reader.readUE(); // bit_depth_chroma_minus8
      reader.readBit(); // qpprime_y_zero_transform_bypass_flag
      if (reader.readBit()) {
        const count = chromaFormatIdc !== 3 ? 8 : 12;
        for (let index = 0; index < count; index += 1) {
          if (reader.readBit()) skipScalingList(reader, index < 6 ? 16 : 64);
        }
      }
    }

    reader.readUE(); // log2_max_frame_num_minus4
    const picOrderCntType = reader.readUE();
    if (picOrderCntType === 0) {
      reader.readUE();
    } else if (picOrderCntType === 1) {
      reader.readBit();
      reader.readSE();
      reader.readSE();
      const cycle = reader.readUE();
      for (let index = 0; index < cycle; index += 1) reader.readSE();
    }

    reader.readUE(); // max_num_ref_frames
    reader.readBit(); // gaps_in_frame_num_value_allowed_flag
    const picWidthInMbsMinus1 = reader.readUE();
    const picHeightInMapUnitsMinus1 = reader.readUE();
    const frameMbsOnlyFlag = reader.readBit();
    if (!frameMbsOnlyFlag) reader.readBit(); // mb_adaptive_frame_field_flag
    reader.readBit(); // direct_8x8_inference_flag

    let cropLeft = 0;
    let cropRight = 0;
    let cropTop = 0;
    let cropBottom = 0;
    if (reader.readBit()) {
      cropLeft = reader.readUE();
      cropRight = reader.readUE();
      cropTop = reader.readUE();
      cropBottom = reader.readUE();
    }

    let cropUnitX = 1;
    let cropUnitY = 2 - frameMbsOnlyFlag;
    if (chromaFormatIdc === 1) {
      cropUnitX = 2;
      cropUnitY = 2 * (2 - frameMbsOnlyFlag);
    } else if (chromaFormatIdc === 2) {
      cropUnitX = 2;
      cropUnitY = 2 - frameMbsOnlyFlag;
    } else if (chromaFormatIdc === 3) {
      cropUnitX = 1;
      cropUnitY = 2 - frameMbsOnlyFlag;
    }

    const width = ((picWidthInMbsMinus1 + 1) * 16) - (cropLeft + cropRight) * cropUnitX;
    const height = ((2 - frameMbsOnlyFlag) * (picHeightInMapUnitsMinus1 + 1) * 16) -
      (cropTop + cropBottom) * cropUnitY;

    return {
      profileIdc,
      profileCompat,
      levelIdc,
      width,
      height
    };
  }

  function findStartCodes(bytes) {
    const starts = [];
    let index = 0;
    while (index + 3 < bytes.length) {
      if (bytes[index] === 0 && bytes[index + 1] === 0) {
        if (bytes[index + 2] === 1) {
          starts.push({ start: index, dataStart: index + 3 });
          index += 3;
          continue;
        }
        if (bytes[index + 2] === 0 && bytes[index + 3] === 1) {
          starts.push({ start: index, dataStart: index + 4 });
          index += 4;
          continue;
        }
      }
      index += 1;
    }
    return starts;
  }

  function annexBNals(bytes) {
    const starts = findStartCodes(bytes);
    if (!starts.length) return [];
    const nals = [];
    for (let index = 0; index < starts.length; index += 1) {
      const current = starts[index];
      const end = index + 1 < starts.length ? starts[index + 1].start : bytes.length;
      if (end > current.dataStart) nals.push(bytes.subarray(current.dataStart, end));
    }
    return nals;
  }

  function avccSampleFromPes(payload) {
    const nals = annexBNals(payload);
    if (!nals.length) return null;

    const sampleParts = [];
    let keyframe = false;
    let sps = null;
    let pps = null;

    for (const nal of nals) {
      if (!nal.length) continue;
      const type = nal[0] & 0x1f;
      if (type === 7) {
        if (!sps) sps = new Uint8Array(nal);
        continue;
      }
      if (type === 8) {
        if (!pps) pps = new Uint8Array(nal);
        continue;
      }
      if (type === 9) continue; // AUD is not needed in AVCC samples.
      if (type === 5) keyframe = true;
      sampleParts.push(uint32(nal.byteLength), nal);
    }

    if (!sampleParts.length) return { data: null, keyframe, sps, pps };
    return { data: concatArrays(sampleParts), keyframe, sps, pps };
  }

  function parseAdtsFrames(payload, pts90k) {
    const sampleRates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
    const frames = [];
    let offset = 0;
    let frameIndex = 0;
    let config = null;

    while (offset + 7 <= payload.length) {
      if (payload[offset] !== 0xff || (payload[offset + 1] & 0xf6) !== 0xf0) {
        offset += 1;
        continue;
      }

      const protectionAbsent = payload[offset + 1] & 0x01;
      const profile = (payload[offset + 2] >>> 6) & 0x03;
      const sampleRateIndex = (payload[offset + 2] >>> 2) & 0x0f;
      const sampleRate = sampleRates[sampleRateIndex];
      if (!sampleRate) {
        offset += 1;
        continue;
      }

      const channelConfig = ((payload[offset + 2] & 0x01) << 2) | ((payload[offset + 3] >>> 6) & 0x03);
      const frameLength = ((payload[offset + 3] & 0x03) << 11) |
        (payload[offset + 4] << 3) |
        ((payload[offset + 5] >>> 5) & 0x07);
      const headerLength = protectionAbsent ? 7 : 9;

      if (frameLength <= headerLength || offset + frameLength > payload.length) break;

      if (!config) {
        const objectType = profile + 1;
        const asc = u8(
          ((objectType << 3) | (sampleRateIndex >>> 1)) & 0xff,
          (((sampleRateIndex & 1) << 7) | (channelConfig << 3)) & 0xff
        );
        config = { sampleRate, sampleRateIndex, channelConfig, objectType, asc };
      }

      const data = new Uint8Array(payload.subarray(offset + headerLength, offset + frameLength));
      const pts = Number.isFinite(pts90k)
        ? pts90k + frameIndex * (1024 * PTS_TIMESCALE / sampleRate)
        : null;
      frames.push({ data, pts90k: pts });
      frameIndex += 1;
      offset += frameLength;
    }

    return { frames, config };
  }

  function parsePat(payload, payloadUnitStart) {
    let offset = 0;
    if (payloadUnitStart) {
      if (!payload.length) return null;
      offset = 1 + payload[0];
    }
    if (offset + 8 > payload.length || payload[offset] !== 0x00) return null;
    const sectionLength = ((payload[offset + 1] & 0x0f) << 8) | payload[offset + 2];
    const end = Math.min(payload.length, offset + 3 + sectionLength - 4);
    let position = offset + 8;
    while (position + 4 <= end) {
      const programNumber = (payload[position] << 8) | payload[position + 1];
      const pid = ((payload[position + 2] & 0x1f) << 8) | payload[position + 3];
      if (programNumber !== 0) return pid;
      position += 4;
    }
    return null;
  }

  function parsePmt(payload, payloadUnitStart) {
    let offset = 0;
    if (payloadUnitStart) {
      if (!payload.length) return null;
      offset = 1 + payload[0];
    }
    if (offset + 12 > payload.length || payload[offset] !== 0x02) return null;
    const sectionLength = ((payload[offset + 1] & 0x0f) << 8) | payload[offset + 2];
    const sectionEnd = Math.min(payload.length, offset + 3 + sectionLength - 4);
    const programInfoLength = ((payload[offset + 10] & 0x0f) << 8) | payload[offset + 11];
    let position = offset + 12 + programInfoLength;
    let videoPid = null;
    let audioPid = null;
    let unsupportedVideoType = null;

    while (position + 5 <= sectionEnd) {
      const streamType = payload[position];
      const elementaryPid = ((payload[position + 1] & 0x1f) << 8) | payload[position + 2];
      const esInfoLength = ((payload[position + 3] & 0x0f) << 8) | payload[position + 4];
      if (streamType === VIDEO_STREAM_TYPE_H264 && videoPid === null) videoPid = elementaryPid;
      else if (streamType === AUDIO_STREAM_TYPE_AAC && audioPid === null) audioPid = elementaryPid;
      else if ([0x24, 0x02, 0x10].includes(streamType) && unsupportedVideoType === null) unsupportedVideoType = streamType;
      position += 5 + esInfoLength;
    }

    return { videoPid, audioPid, unsupportedVideoType };
  }

  function parsePes(bytes) {
    if (!bytes || bytes.length < 9) return null;
    if (bytes[0] !== 0x00 || bytes[1] !== 0x00 || bytes[2] !== 0x01) return null;
    const flags = bytes[7];
    const headerLength = bytes[8];
    let pts = null;
    let dts = null;
    const ptsDtsFlags = (flags >>> 6) & 0x03;
    if (ptsDtsFlags === 2 && bytes.length >= 14) {
      pts = parsePts(bytes, 9);
      dts = pts;
    } else if (ptsDtsFlags === 3 && bytes.length >= 19) {
      pts = parsePts(bytes, 9);
      dts = parsePts(bytes, 14);
    }
    const payloadStart = 9 + headerLength;
    if (payloadStart > bytes.length) return null;
    return { pts, dts, payload: bytes.subarray(payloadStart) };
  }

  class TsDemuxer {
    constructor() {
      this.pmtPid = null;
      this.videoPid = null;
      this.audioPid = null;
      this.unsupportedVideoType = null;
      this.pesParts = new Map();
      this.videoSamples = [];
      this.audioSamples = [];
      this.sps = null;
      this.pps = null;
      this.spsInfo = null;
      this.audioConfig = null;
      this.lastVideoDts = null;
      this.lastAudioPts = null;
    }

    push(buffer) {
      const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      let offset = 0;
      while (offset + TS_PACKET_SIZE <= bytes.length) {
        if (bytes[offset] !== 0x47) {
          const next = bytes.indexOf(0x47, offset + 1);
          if (next < 0) break;
          offset = next;
          continue;
        }
        this.parsePacket(bytes.subarray(offset, offset + TS_PACKET_SIZE));
        offset += TS_PACKET_SIZE;
      }
    }

    parsePacket(packet) {
      const payloadUnitStart = Boolean(packet[1] & 0x40);
      const pid = ((packet[1] & 0x1f) << 8) | packet[2];
      const adaptationControl = (packet[3] >>> 4) & 0x03;
      if (adaptationControl === 0 || adaptationControl === 2) return;

      let offset = 4;
      if (adaptationControl === 3) {
        const adaptationLength = packet[offset];
        offset += 1 + adaptationLength;
      }
      if (offset >= TS_PACKET_SIZE) return;
      const payload = packet.subarray(offset);

      if (pid === 0) {
        const pmtPid = parsePat(payload, payloadUnitStart);
        if (Number.isInteger(pmtPid)) this.pmtPid = pmtPid;
        return;
      }

      if (this.pmtPid !== null && pid === this.pmtPid) {
        const pmt = parsePmt(payload, payloadUnitStart);
        if (pmt) {
          if (pmt.videoPid !== null) this.videoPid = pmt.videoPid;
          if (pmt.audioPid !== null) this.audioPid = pmt.audioPid;
          if (pmt.unsupportedVideoType !== null) this.unsupportedVideoType = pmt.unsupportedVideoType;
        }
        return;
      }

      if (pid !== this.videoPid && pid !== this.audioPid) return;

      if (payloadUnitStart) this.flushPid(pid);
      if (!this.pesParts.has(pid)) this.pesParts.set(pid, []);
      this.pesParts.get(pid).push(new Uint8Array(payload));
    }

    flushPid(pid) {
      const parts = this.pesParts.get(pid);
      if (!parts?.length) return;
      this.pesParts.delete(pid);
      const pes = parsePes(concatArrays(parts));
      if (!pes) return;
      if (pid === this.videoPid) this.consumeVideoPes(pes);
      else if (pid === this.audioPid) this.consumeAudioPes(pes);
    }

    consumeVideoPes(pes) {
      const parsed = avccSampleFromPes(pes.payload);
      if (!parsed) return;
      if (parsed.sps) {
        this.sps = parsed.sps;
        this.spsInfo = parseSps(parsed.sps) || this.spsInfo;
      }
      if (parsed.pps) this.pps = parsed.pps;
      if (!parsed.data?.byteLength) return;

      let dts = Number.isFinite(pes.dts) ? pes.dts : pes.pts;
      let pts = Number.isFinite(pes.pts) ? pes.pts : dts;
      dts = unwrapTimestamp(dts, this.lastVideoDts);
      pts = unwrapTimestamp(pts, dts);
      if (Number.isFinite(dts)) this.lastVideoDts = dts;

      this.videoSamples.push({
        data: parsed.data,
        dts90k: dts,
        pts90k: pts,
        keyframe: parsed.keyframe
      });
    }

    consumeAudioPes(pes) {
      let pts = unwrapTimestamp(pes.pts, this.lastAudioPts);
      const parsed = parseAdtsFrames(pes.payload, pts);
      if (parsed.config && !this.audioConfig) this.audioConfig = parsed.config;
      if (!this.audioConfig) return;
      for (const frame of parsed.frames) {
        const unwrapped = unwrapTimestamp(frame.pts90k, this.lastAudioPts);
        if (Number.isFinite(unwrapped)) this.lastAudioPts = unwrapped;
        this.audioSamples.push({ data: frame.data, pts90k: unwrapped });
      }
    }

    flush() {
      for (const pid of [...this.pesParts.keys()]) this.flushPid(pid);
      if (!this.videoSamples.length) {
        if (this.unsupportedVideoType === 0x24) throw new Error('El stream usa HEVC/H.265 en MPEG-TS; esta conversión MP4 admite H.264 por ahora.');
        throw new Error('No se encontró video H.264 dentro de los segmentos TS.');
      }
      if (!this.sps || !this.pps) throw new Error('No se encontraron SPS/PPS H.264 necesarios para crear el MP4.');
      return this.finalizeTracks();
    }

    finalizeTracks() {
      const video = this.videoSamples.sort((a, b) => (a.dts90k ?? 0) - (b.dts90k ?? 0));
      const firstVideoDts = Number.isFinite(video[0].dts90k) ? video[0].dts90k : 0;
      const defaultVideoDuration = 3003;
      let previousDuration = defaultVideoDuration;

      for (let index = 0; index < video.length; index += 1) {
        const current = video[index];
        const next = video[index + 1];
        const dts = Number.isFinite(current.dts90k) ? current.dts90k - firstVideoDts : index * previousDuration;
        const pts = Number.isFinite(current.pts90k) ? current.pts90k - firstVideoDts : dts;
        let duration = next && Number.isFinite(next.dts90k) && Number.isFinite(current.dts90k)
          ? Math.round(next.dts90k - current.dts90k)
          : previousDuration;
        if (!Number.isFinite(duration) || duration <= 0 || duration > PTS_TIMESCALE) duration = previousDuration;
        previousDuration = duration;
        current.dts = Math.max(0, Math.round(dts));
        current.pts = Math.max(0, Math.round(pts));
        current.duration = duration;
        current.cto = Math.round(current.pts - current.dts);
      }

      let audio = null;
      if (this.audioConfig && this.audioSamples.length) {
        const config = this.audioConfig;
        const firstAudioPts90k = Number.isFinite(this.audioSamples[0].pts90k)
          ? this.audioSamples[0].pts90k
          : firstVideoDts;
        const samples = this.audioSamples.sort((a, b) => (a.pts90k ?? 0) - (b.pts90k ?? 0));
        let decodeTime = Math.max(0, Math.round((firstAudioPts90k - firstVideoDts) * config.sampleRate / PTS_TIMESCALE));
        for (const sample of samples) {
          sample.dts = decodeTime;
          sample.pts = decodeTime;
          sample.duration = 1024;
          sample.cto = 0;
          decodeTime += 1024;
        }
        audio = { ...config, samples };
      }

      return {
        video: {
          timescale: PTS_TIMESCALE,
          samples: video,
          sps: this.sps,
          pps: this.pps,
          info: this.spsInfo || { profileIdc: this.sps[1] || 66, profileCompat: this.sps[2] || 0, levelIdc: this.sps[3] || 30, width: 0, height: 0 }
        },
        audio
      };
    }
  }

  function mvhd(timescale = 1000) {
    return fullBox('mvhd', 0, 0,
      uint32(0), uint32(0), uint32(timescale), uint32(0),
      fixed16_16(1), fixed8_8(1), uint16(0),
      new Uint8Array(8),
      concatArrays([
        uint32(0x00010000), uint32(0), uint32(0),
        uint32(0), uint32(0x00010000), uint32(0),
        uint32(0), uint32(0), uint32(0x40000000)
      ]),
      new Uint8Array(24),
      uint32(3)
    );
  }

  function tkhd(trackId, width, height, volume) {
    return fullBox('tkhd', 0, 0x000007,
      uint32(0), uint32(0), uint32(trackId), uint32(0), uint32(0),
      new Uint8Array(8),
      uint16(0), uint16(0), fixed8_8(volume), uint16(0),
      concatArrays([
        uint32(0x00010000), uint32(0), uint32(0),
        uint32(0), uint32(0x00010000), uint32(0),
        uint32(0), uint32(0), uint32(0x40000000)
      ]),
      fixed16_16(width), fixed16_16(height)
    );
  }

  function mdhd(timescale) {
    return fullBox('mdhd', 0, 0,
      uint32(0), uint32(0), uint32(timescale), uint32(0),
      uint16(0x55c4), uint16(0) // und
    );
  }

  function hdlr(type, name) {
    return fullBox('hdlr', 0, 0,
      uint32(0), ascii(type), new Uint8Array(12), ascii(name), u8(0)
    );
  }

  function vmhd() {
    return fullBox('vmhd', 0, 1, uint16(0), uint16(0), uint16(0), uint16(0));
  }

  function smhd() {
    return fullBox('smhd', 0, 0, uint16(0), uint16(0));
  }

  function dinf() {
    const url = fullBox('url ', 0, 1);
    const dref = fullBox('dref', 0, 0, uint32(1), url);
    return box('dinf', dref);
  }

  function avcC(video) {
    const sps = video.sps;
    const pps = video.pps;
    const info = video.info;
    return box('avcC',
      u8(1, info.profileIdc || sps[1] || 66, info.profileCompat ?? sps[2] ?? 0, info.levelIdc || sps[3] || 30, 0xff, 0xe1),
      uint16(sps.byteLength), sps,
      u8(1), uint16(pps.byteLength), pps
    );
  }

  function videoSampleEntry(video) {
    const width = video.info.width || 1920;
    const height = video.info.height || 1080;
    const compressor = new Uint8Array(32);
    const name = ascii('MediaDrop H.264');
    compressor[0] = Math.min(31, name.length);
    compressor.set(name.subarray(0, 31), 1);

    const payload = concatArrays([
      new Uint8Array(6), uint16(1),
      uint16(0), uint16(0), new Uint8Array(12),
      uint16(width), uint16(height),
      uint32(0x00480000), uint32(0x00480000),
      uint32(0), uint16(1), compressor,
      uint16(0x0018), uint16(0xffff),
      avcC(video)
    ]);
    return box('avc1', payload);
  }

  function esds(audio) {
    const decoderSpecific = descriptor(0x05, audio.asc);
    const decoderConfig = descriptor(0x04, concatArrays([
      u8(0x40), // MPEG-4 Audio
      u8(0x15), // streamType=5 audio, upstream=0, reserved=1
      uint24(0),
      uint32(0),
      uint32(0),
      decoderSpecific
    ]));
    const slConfig = descriptor(0x06, u8(0x02));
    const esDescriptor = descriptor(0x03, concatArrays([uint16(2), u8(0), decoderConfig, slConfig]));
    return fullBox('esds', 0, 0, esDescriptor);
  }

  function audioSampleEntry(audio) {
    return box('mp4a',
      new Uint8Array(6), uint16(1),
      new Uint8Array(8),
      uint16(audio.channelConfig || 2),
      uint16(16), uint16(0), uint16(0),
      uint32(audio.sampleRate << 16),
      esds(audio)
    );
  }

  function emptyStbl(entry) {
    const stsd = fullBox('stsd', 0, 0, uint32(1), entry);
    const stts = fullBox('stts', 0, 0, uint32(0));
    const stsc = fullBox('stsc', 0, 0, uint32(0));
    const stsz = fullBox('stsz', 0, 0, uint32(0), uint32(0));
    const stco = fullBox('stco', 0, 0, uint32(0));
    return box('stbl', stsd, stts, stsc, stsz, stco);
  }

  function videoTrak(video) {
    const width = video.info.width || 1920;
    const height = video.info.height || 1080;
    const minf = box('minf', vmhd(), dinf(), emptyStbl(videoSampleEntry(video)));
    const mdia = box('mdia', mdhd(video.timescale), hdlr('vide', 'VideoHandler'), minf);
    return box('trak', tkhd(1, width, height, 0), mdia);
  }

  function audioTrak(audio) {
    const minf = box('minf', smhd(), dinf(), emptyStbl(audioSampleEntry(audio)));
    const mdia = box('mdia', mdhd(audio.sampleRate), hdlr('soun', 'SoundHandler'), minf);
    return box('trak', tkhd(2, 0, 0, 1), mdia);
  }

  function trex(trackId) {
    return fullBox('trex', 0, 0,
      uint32(trackId), uint32(1), uint32(0), uint32(0), uint32(0)
    );
  }

  function initSegment(tracks) {
    const ftyp = box('ftyp', ascii('isom'), uint32(0x200), ascii('isom'), ascii('iso6'), ascii('avc1'), ascii('mp41'));
    const moovParts = [mvhd(), videoTrak(tracks.video)];
    if (tracks.audio) moovParts.push(audioTrak(tracks.audio));
    const trexParts = [trex(1)];
    if (tracks.audio) trexParts.push(trex(2));
    moovParts.push(box('mvex', ...trexParts));
    return concatArrays([ftyp, box('moov', ...moovParts)]);
  }

  function tfhd(trackId) {
    // default-base-is-moof
    return fullBox('tfhd', 0, 0x020000, uint32(trackId));
  }

  function tfdt(baseDecodeTime) {
    if (baseDecodeTime > 0xffffffff) return fullBox('tfdt', 1, 0, uint64(baseDecodeTime));
    return fullBox('tfdt', 0, 0, uint32(baseDecodeTime));
  }

  function sampleFlags(keyframe) {
    // sample_depends_on=2 for keyframes, 1 + non-sync for inter frames.
    return keyframe ? 0x02000000 : 0x01010000;
  }

  function trun(samples, dataOffset, includeFlags) {
    const hasNegativeCto = samples.some((sample) => sample.cto < 0);
    const version = hasNegativeCto ? 1 : 0;
    const flags = 0x000001 | 0x000100 | 0x000200 | (includeFlags ? 0x000400 : 0) | 0x000800;

    // IMPORTANT: long videos can contain tens of thousands of samples.
    // Passing every sample field as `...entries` to fullBox() hits Chromium's
    // maximum function-argument/call-stack limit. Build the trun table as one
    // contiguous byte buffer instead, so duration is no longer constrained by
    // JavaScript's argument-count ceiling.
    const fieldsPerSample = includeFlags ? 4 : 3;
    const entryTable = new Uint8Array(samples.length * fieldsPerSample * 4);
    let offset = 0;

    const writeUint32 = (value) => {
      const number = Number(value) >>> 0;
      entryTable[offset++] = (number >>> 24) & 0xff;
      entryTable[offset++] = (number >>> 16) & 0xff;
      entryTable[offset++] = (number >>> 8) & 0xff;
      entryTable[offset++] = number & 0xff;
    };

    for (const sample of samples) {
      writeUint32(sample.duration);
      writeUint32(sample.data.byteLength);

      if (includeFlags) {
        writeUint32(sampleFlags(Boolean(sample.keyframe)));
      }

      // Signed CTO for trun version 1 uses the same 32-bit two's complement
      // byte representation as an unsigned write.
      writeUint32(
        version === 1
          ? (sample.cto || 0)
          : Math.max(0, sample.cto || 0)
      );
    }

    return fullBox(
      'trun',
      version,
      flags,
      uint32(samples.length),
      int32(dataOffset),
      entryTable
    );
  }

  function traf(trackId, samples, dataOffset, includeFlags) {
    const base = samples[0]?.dts || 0;
    return box('traf', tfhd(trackId), tfdt(base), trun(samples, dataOffset, includeFlags));
  }

  function moof(tracks, sequenceNumber, videoOffset = 0, audioOffset = 0) {
    const parts = [fullBox('mfhd', 0, 0, uint32(sequenceNumber))];
    parts.push(traf(1, tracks.video.samples, videoOffset, true));
    if (tracks.audio?.samples?.length) parts.push(traf(2, tracks.audio.samples, audioOffset, false));
    return box('moof', ...parts);
  }

  function buildFragment(tracks) {
    const videoSamples = tracks.video.samples;
    const audioSamples = tracks.audio?.samples || [];
    const videoBytes = videoSamples.reduce((sum, sample) => sum + sample.data.byteLength, 0);

    let preliminary = moof(tracks, 1, 0, 0);
    const videoOffset = preliminary.byteLength + 8;
    const audioOffset = videoOffset + videoBytes;
    const header = moof(tracks, 1, videoOffset, audioOffset);

    const payloadSize = videoBytes + audioSamples.reduce((sum, sample) => sum + sample.data.byteLength, 0);
    const mdatHeader = concatArrays([uint32(payloadSize + 8), ascii('mdat')]);
    return {
      header,
      mdatHeader,
      mediaParts: [
        ...videoSamples.map((sample) => sample.data),
        ...audioSamples.map((sample) => sample.data)
      ]
    };
  }

  function transmux(buffers) {
    if (!Array.isArray(buffers) || !buffers.length) throw new Error('No hay segmentos MPEG-TS para convertir.');
    const demuxer = new TsDemuxer();
    for (const buffer of buffers) demuxer.push(buffer);
    const tracks = demuxer.flush();
    const init = initSegment(tracks);
    const fragment = buildFragment(tracks);
    const parts = [init, fragment.header, fragment.mdatHeader];
    for (const mediaPart of fragment.mediaParts) parts.push(mediaPart);
    const totalBytes = parts.reduce((sum, part) => sum + part.byteLength, 0);
    return {
      parts,
      totalBytes,
      width: tracks.video.info.width || 0,
      height: tracks.video.info.height || 0,
      videoSamples: tracks.video.samples.length,
      audioSamples: tracks.audio?.samples?.length || 0,
      hasAudio: Boolean(tracks.audio?.samples?.length)
    };
  }

  globalThis.MediaDropTsToMp4 = { transmux };
})();
