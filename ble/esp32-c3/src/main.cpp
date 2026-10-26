#include <Arduino.h>
#include <NimBLEDevice.h>
#include <mbedtls/md.h>
#include <cstring>
#include <string>

#include "credentials.h"

static constexpr char SERVICE_UUID[] = "6f3a0001-5f3d-4b7a-9c2a-2d8f1e0a0001";
static constexpr char CHALLENGE_UUID[] = "6f3a0002-5f3d-4b7a-9c2a-2d8f1e0a0002";
static constexpr char RESPONSE_UUID[] = "6f3a0003-5f3d-4b7a-9c2a-2d8f1e0a0003";

NimBLECharacteristic* responseCharacteristic = nullptr;

bool decodeHexKey(uint8_t output[32]) {
  if (std::strlen(BEACON_KEY_HEX) != 64) return false;
  for (size_t i = 0; i < 32; ++i) {
    char pair[3] = {BEACON_KEY_HEX[i * 2], BEACON_KEY_HEX[i * 2 + 1], '\0'};
    char* end = nullptr;
    const long value = std::strtol(pair, &end, 16);
    if (end == pair || *end != '\0' || value < 0 || value > 255) return false;
    output[i] = static_cast<uint8_t>(value);
  }
  return true;
}

bool validNonce(const std::string& nonce) {
  if (nonce.size() != 32) return false;
  for (char value : nonce) {
    if (!((value >= '0' && value <= '9') || (value >= 'a' && value <= 'f'))) return false;
  }
  return true;
}

std::string hmacHex(const std::string& nonce) {
  uint8_t key[32];
  uint8_t digest[32];
  if (!decodeHexKey(key)) return "CONFIG_ERROR";
  const std::string message = nonce + "|" + BEACON_ID;
  const auto* algorithm = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (algorithm == nullptr || mbedtls_md_hmac(algorithm, key, sizeof(key),
      reinterpret_cast<const unsigned char*>(message.data()), message.size(), digest) != 0) {
    return "CRYPTO_ERROR";
  }
  static constexpr char hex[] = "0123456789abcdef";
  std::string result;
  result.reserve(64);
  for (uint8_t byte : digest) {
    result.push_back(hex[byte >> 4]);
    result.push_back(hex[byte & 0x0f]);
  }
  memset(key, 0, sizeof(key));
  memset(digest, 0, sizeof(digest));
  return result;
}

class ChallengeCallbacks final : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* characteristic, NimBLEConnInfo&) override {
    const std::string nonce = characteristic->getValue();
    if (!validNonce(nonce)) {
      responseCharacteristic->setValue("INVALID_CHALLENGE");
      return;
    }
    const std::string proof = hmacHex(nonce);
    responseCharacteristic->setValue(std::string(BEACON_ID) + "|" + nonce + "|" + proof);
  }
};

void setup() {
  Serial.begin(115200);
  uint8_t keyCheck[32];
  if (!decodeHexKey(keyCheck)) {
    Serial.println("Invalid beacon key. Expected 64 hexadecimal characters.");
    while (true) delay(1000);
  }
  memset(keyCheck, 0, sizeof(keyCheck));

  NimBLEDevice::init(BEACON_ID);
  NimBLEServer* server = NimBLEDevice::createServer();
  NimBLEService* service = server->createService(SERVICE_UUID);
  auto* challenge = service->createCharacteristic(CHALLENGE_UUID, NIMBLE_PROPERTY::WRITE);
  responseCharacteristic = service->createCharacteristic(RESPONSE_UUID, NIMBLE_PROPERTY::READ);
  responseCharacteristic->setValue("READY");
  challenge->setCallbacks(new ChallengeCallbacks());
  service->start();

  NimBLEAdvertising* advertising = NimBLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->start();
  Serial.printf("Attendance beacon %s is advertising.\n", BEACON_ID);
}

void loop() { delay(1000); }
