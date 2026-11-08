#pragma once

#include <tiffio.h>
#include <emscripten/val.h>

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <fstream>
#include <limits>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

// Encodes browser RGBA pixels as an opaque RGB TIFF using libtiff.
class TiffEncoder {
 public:
  // Reads RGBA pixels and a JSON metadata payload from the WASM call, then
  // writes an 8- or 16-bit LZW TIFF to MEMFS. The current WebGL source is 8-bit;
  // the 16-bit mode scales those samples to the full uint16 range.
  static void encodeTiff(const std::string& rgbaPath,
                         const std::string& tiffPath, int width, int height,
                         int bitDepth, const std::string& metadataJson) {
    if (width <= 0 || height <= 0) {
      throw std::invalid_argument("TIFF dimensions must be positive");
    }
    if (bitDepth != 8 && bitDepth != 16) {
      throw std::invalid_argument("TIFF bit depth must be 8 or 16");
    }

    const size_t maxSize = std::numeric_limits<size_t>::max();
    if (static_cast<size_t>(width) > maxSize / static_cast<size_t>(height)) {
      throw std::invalid_argument("TIFF dimensions are too large");
    }
    const size_t pixelCount = static_cast<size_t>(width) * height;
    if (pixelCount > maxSize / 4 ||
        static_cast<uint64_t>(pixelCount) * 4 >
            static_cast<uint64_t>(std::numeric_limits<std::streamoff>::max())) {
      throw std::invalid_argument("TIFF dimensions are too large");
    }
    if (bitDepth == 16 &&
        static_cast<size_t>(width) > maxSize / (3 * sizeof(uint16_t))) {
      throw std::invalid_argument("TIFF row is too large");
    }

    std::ifstream input(rgbaPath, std::ios::binary | std::ios::ate);
    if (!input) {
      throw std::runtime_error("Could not open the RGBA input file");
    }
    const std::streamoff expectedBytes =
        static_cast<std::streamoff>(pixelCount * 4);
    if (input.tellg() != expectedBytes) {
      throw std::invalid_argument("RGBA byte count does not match dimensions");
    }
    input.seekg(0, std::ios::beg);

    const emscripten::val metadata =
        emscripten::val::global("JSON").call<emscripten::val>(
            "parse", metadataJson);
    if (metadata.isNull() || metadata.isUndefined() ||
        metadata.typeOf().as<std::string>() != "object") {
      throw std::invalid_argument("TIFF metadata must be a JSON object");
    }

    const auto stringField = [](const emscripten::val& object,
                                const char* key) -> std::string {
      const emscripten::val value = object[key];
      if (value.isUndefined() || value.isNull() ||
          value.typeOf().as<std::string>() != "string") {
        return {};
      }
      return value.as<std::string>();
    };
    const auto numberField = [](const emscripten::val& object, const char* key,
                                double& result) -> bool {
      const emscripten::val value = object[key];
      if (value.isUndefined() || value.isNull() ||
          value.typeOf().as<std::string>() != "number") {
        return false;
      }
      result = value.as<double>();
      return std::isfinite(result);
    };
    const auto coordinateField = [](const emscripten::val& object,
                                    const char* key, double (&result)[3],
                                    double maxDegrees) -> bool {
      const emscripten::val values = object[key];
      if (values.isUndefined() || values.isNull() ||
          !emscripten::val::global("Array")
               .call<bool>("isArray", values) ||
          values["length"].as<unsigned>() != 3) {
        return false;
      }
      for (unsigned index = 0; index < 3; ++index) {
        const emscripten::val value = values[index];
        if (value.typeOf().as<std::string>() != "number") return false;
        result[index] = value.as<double>();
        if (!std::isfinite(result[index])) return false;
      }
      return result[0] >= 0 && result[0] <= maxDegrees &&
             result[1] >= 0 && result[1] < 60 && result[2] >= 0 &&
             result[2] < 60 &&
             (result[0] != maxDegrees ||
              (result[1] == 0 && result[2] == 0));
    };

    const std::string make = stringField(metadata, "make");
    const std::string model = stringField(metadata, "model");
    const std::string software = stringField(metadata, "software");
    const std::string artist = stringField(metadata, "artist");
    const std::string dateTimeOriginal =
        stringField(metadata, "dateTimeOriginal");

    double exposureTime = 0;
    double fNumber = 0;
    double focalLength = 0;
    double isoValue = 0;
    const bool hasExposureTime =
        numberField(metadata, "exposureTime", exposureTime) && exposureTime > 0;
    const bool hasFNumber =
        numberField(metadata, "fNumber", fNumber) && fNumber > 0;
    const bool hasFocalLength =
        numberField(metadata, "focalLength", focalLength) && focalLength > 0;
    const bool hasIso = numberField(metadata, "iso", isoValue) &&
                        isoValue >= 1 && isoValue <= 65535 &&
                        std::floor(isoValue) == isoValue;
    const uint16_t iso = hasIso ? static_cast<uint16_t>(isoValue) : 0;
    const bool hasExif = hasExposureTime || hasFNumber || hasFocalLength ||
                         hasIso || !dateTimeOriginal.empty();

    const emscripten::val gps = metadata["gps"];
    const bool gpsIsObject =
        !gps.isUndefined() && !gps.isNull() &&
        gps.typeOf().as<std::string>() == "object" &&
        !emscripten::val::global("Array").call<bool>("isArray", gps);
    const std::string latitudeRef =
        gpsIsObject ? stringField(gps, "latitudeRef") : std::string{};
    const std::string longitudeRef =
        gpsIsObject ? stringField(gps, "longitudeRef") : std::string{};
    double latitude[3] = {};
    double longitude[3] = {};
    const bool hasGps =
        gpsIsObject &&
        (latitudeRef == "N" || latitudeRef == "S") &&
        (longitudeRef == "E" || longitudeRef == "W") &&
        coordinateField(gps, "latitude", latitude, 90) &&
        coordinateField(gps, "longitude", longitude, 180);

    std::unique_ptr<TIFF, decltype(&TIFFClose)> tiff(
        TIFFOpen(tiffPath.c_str(), "w"), &TIFFClose);
    if (!tiff) {
      throw std::runtime_error("Could not open TIFF output file");
    }
    TIFF* const output = tiff.get();

    const bool tagsWritten =
        TIFFSetField(output, TIFFTAG_IMAGEWIDTH,
                     static_cast<uint32_t>(width)) &&
        TIFFSetField(output, TIFFTAG_IMAGELENGTH,
                     static_cast<uint32_t>(height)) &&
        TIFFSetField(output, TIFFTAG_SAMPLESPERPIXEL, 3) &&
        TIFFSetField(output, TIFFTAG_BITSPERSAMPLE,
                     static_cast<uint16_t>(bitDepth)) &&
        TIFFSetField(output, TIFFTAG_SAMPLEFORMAT, SAMPLEFORMAT_UINT) &&
        TIFFSetField(output, TIFFTAG_PHOTOMETRIC, PHOTOMETRIC_RGB) &&
        TIFFSetField(output, TIFFTAG_COMPRESSION, COMPRESSION_LZW) &&
        TIFFSetField(output, TIFFTAG_PLANARCONFIG, PLANARCONFIG_CONTIG) &&
        TIFFSetField(output, TIFFTAG_ORIENTATION, ORIENTATION_TOPLEFT) &&
        TIFFSetField(output, TIFFTAG_ROWSPERSTRIP,
                     TIFFDefaultStripSize(output, 0));
    if (!tagsWritten) {
      throw std::runtime_error("Could not configure TIFF image tags");
    }

    if (!make.empty() && !TIFFSetField(output, TIFFTAG_MAKE, make.c_str())) {
      throw std::runtime_error("Could not write TIFF camera make");
    }
    if (!model.empty() && !TIFFSetField(output, TIFFTAG_MODEL, model.c_str())) {
      throw std::runtime_error("Could not write TIFF camera model");
    }
    if (!software.empty() &&
        !TIFFSetField(output, TIFFTAG_SOFTWARE, software.c_str())) {
      throw std::runtime_error("Could not write TIFF software tag");
    }
    if (!artist.empty() && !TIFFSetField(output, TIFFTAG_ARTIST, artist.c_str())) {
      throw std::runtime_error("Could not write TIFF artist tag");
    }

    // Reserve the pointer fields before writing image data. Their final offsets
    // are filled after the EXIF/GPS custom directories have been written.
    if (hasExif &&
        !TIFFSetField(output, TIFFTAG_EXIFIFD, static_cast<uint64_t>(0))) {
      throw std::runtime_error("Could not reserve TIFF EXIF IFD tag");
    }
    if (hasGps &&
        !TIFFSetField(output, TIFFTAG_GPSIFD, static_cast<uint64_t>(0))) {
      throw std::runtime_error("Could not reserve TIFF GPS IFD tag");
    }

    const size_t rgbaRowBytes = static_cast<size_t>(width) * 4;
    std::vector<unsigned char> rgbaRow(rgbaRowBytes);
    std::vector<unsigned char> rgb8Row;
    std::vector<uint16_t> rgb16Row;
    if (bitDepth == 8) {
      rgb8Row.resize(static_cast<size_t>(width) * 3);
    } else {
      rgb16Row.resize(static_cast<size_t>(width) * 3);
    }

    for (int row = 0; row < height; ++row) {
      input.read(reinterpret_cast<char*>(rgbaRow.data()),
                 static_cast<std::streamsize>(rgbaRowBytes));
      if (input.gcount() != static_cast<std::streamsize>(rgbaRowBytes)) {
        throw std::runtime_error("TIFF input ended before all rows were read");
      }

      if (bitDepth == 8) {
        for (int column = 0; column < width; ++column) {
          const size_t source = static_cast<size_t>(column) * 4;
          const size_t target = static_cast<size_t>(column) * 3;
          rgb8Row[target] = rgbaRow[source];
          rgb8Row[target + 1] = rgbaRow[source + 1];
          rgb8Row[target + 2] = rgbaRow[source + 2];
        }
        if (TIFFWriteScanline(output, rgb8Row.data(),
                              static_cast<uint32_t>(row), 0) < 0) {
          throw std::runtime_error("Failed to write TIFF image row");
        }
      } else {
        for (int column = 0; column < width; ++column) {
          const size_t source = static_cast<size_t>(column) * 4;
          const size_t target = static_cast<size_t>(column) * 3;
          rgb16Row[target] = static_cast<uint16_t>(rgbaRow[source] * 257u);
          rgb16Row[target + 1] =
              static_cast<uint16_t>(rgbaRow[source + 1] * 257u);
          rgb16Row[target + 2] =
              static_cast<uint16_t>(rgbaRow[source + 2] * 257u);
        }
        if (TIFFWriteScanline(output, rgb16Row.data(),
                              static_cast<uint32_t>(row), 0) < 0) {
          throw std::runtime_error("Failed to write TIFF image row");
        }
      }
    }

    if (!TIFFWriteDirectory(output)) {
      throw std::runtime_error("Could not write TIFF image directory");
    }

    uint64_t exifOffset = 0;
    if (hasExif) {
      TIFFCreateEXIFDirectory(output);
      if (hasExposureTime &&
          !TIFFSetField(output, EXIFTAG_EXPOSURETIME, exposureTime)) {
        throw std::runtime_error("Could not write EXIF exposure time");
      }
      if (hasFNumber && !TIFFSetField(output, EXIFTAG_FNUMBER, fNumber)) {
        throw std::runtime_error("Could not write EXIF f-number");
      }
      if (hasFocalLength &&
          !TIFFSetField(output, EXIFTAG_FOCALLENGTH, focalLength)) {
        throw std::runtime_error("Could not write EXIF focal length");
      }
      if (hasIso &&
          !TIFFSetField(output, EXIFTAG_ISOSPEEDRATINGS,
                        static_cast<uint16_t>(1), &iso)) {
        throw std::runtime_error("Could not write EXIF ISO speed");
      }
      if (!dateTimeOriginal.empty() &&
          !TIFFSetField(output, EXIFTAG_DATETIMEORIGINAL,
                        dateTimeOriginal.c_str())) {
        throw std::runtime_error("Could not write EXIF original date");
      }
      if (!TIFFWriteCustomDirectory(output, &exifOffset)) {
        throw std::runtime_error("Could not write TIFF EXIF directory");
      }
    }

    uint64_t gpsOffset = 0;
    if (hasGps) {
      TIFFCreateGPSDirectory(output);
      uint8_t gpsVersion[4] = {2, 3, 0, 0};
      if (!TIFFSetField(output, GPSTAG_VERSIONID, gpsVersion) ||
          !TIFFSetField(output, GPSTAG_LATITUDEREF, latitudeRef.c_str()) ||
          !TIFFSetField(output, GPSTAG_LATITUDE, latitude) ||
          !TIFFSetField(output, GPSTAG_LONGITUDEREF, longitudeRef.c_str()) ||
          !TIFFSetField(output, GPSTAG_LONGITUDE, longitude)) {
        throw std::runtime_error("Could not write TIFF GPS tags");
      }
      if (!TIFFWriteCustomDirectory(output, &gpsOffset)) {
        throw std::runtime_error("Could not write TIFF GPS directory");
      }
    }

    if (hasExif || hasGps) {
      if (!TIFFSetDirectory(output, 0)) {
        throw std::runtime_error("Could not reload TIFF image directory");
      }
      if (hasExif && !TIFFSetField(output, TIFFTAG_EXIFIFD, exifOffset)) {
        throw std::runtime_error("Could not link TIFF EXIF directory");
      }
      if (hasGps && !TIFFSetField(output, TIFFTAG_GPSIFD, gpsOffset)) {
        throw std::runtime_error("Could not link TIFF GPS directory");
      }
      if (!TIFFRewriteDirectory(output)) {
        throw std::runtime_error("Could not update TIFF image directory");
      }
    }
  }
};
