// Samsung Air Conditioner Homebridge Plugin
// Version 1.9.18 (Final Performance & Architecture Rework)
'use strict';

const tls = require('tls');
const { constants } = require('crypto');

let HAP;
let Service, Characteristic;

const defaultCertificate = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDeXvhcsqRFWfQt
Qr2TGW+ePJzrKQVNOZmCGFXrBmOKa2gcZvXqDe71upkCmbXxDZbsqU1nFox6WtKy
za+JE1EaWIjVFV/D0hnnF+CA56851rFjAx7YYVtd9TwJYV1lSfJaQBU/ecUys0SX
lKZJtjIoJ/PyLREE79TjOqTxXMXnDpiAt3oiwApZMweJ5z2QViqtRepkI33GDgYc
LzamIengSG6WZkEUr2roY0il4aVXf3IRVRX+5cJ2L5462kFPKm/UnrXrSsrLwbF9
ltSlNA8FgpHN3d9ZyqB3MB46oGYyxYYU7a+/R3RAx0joNfVPFe8riQXQcoNEgalb
c8f7N4HPAgMBAAECggEABL80QA5UMWLNMpYlI9m8Jz2V//MdONvM6hkI5H57a34F
d+2+vCNWAYrdL1AGsUGgAidPDq9NimMb8lMvtxZhedV//kR5id2XTfaVhUrs06hA
myN66hWR9LyCbpTUgJAGi2Soz3US/5USFsZGknZANdk8fOP3ZAqWmc8rrDdVxivg
Z3qjiqgIZg24XsZmnK/QJejP4FLMqm6YUouH//u9xSKvTwkg89qxvygW9xNBNfi/
LrBHip/k8LnynKRE2odQWt74HcTjbZW4rxXrJ0tqDSIh8bUB23mRjFh1k4aKXnz3
Y/CDsfxvAutVi85/zyxYaIT6daP+PxvywwgjVhYHIQKBgQDyMxmGdi5kk3ePv0lM
lC28gVNhgKfhsXL8xIzcd/UM3eEK4baA+AKI9p6ifZ8g90NUJGuHxCp8/9yOKcmk
tY5toE45nH4fH9Z3j9NtWHMhXJDGWV+DjeiWmshbUqd7/OoIl1vig1npQqX+PXJR
pwDHnjkQbkyum4k8/IruHx813wKBgQDrCqK0rBkMaarr5eyOJ9BxhCej8i5kCzm7
XSaNgXtpBIQ4Y4r412M2JWaSLnDxlAc0iUhNGnIn4zkEP2HzX5JU4Yto9YAlRZnu
NQSvuVgyLiBCbS7WrRAlsNpTeCU3m+c5QNXBzBlHCiTdw3WS4bINOftsB3xnlJ+D
y/0YZozSEQKBgQCgWV5z3Dh40/0bSVyA+7WQENsgOWpsjOwBFyvfJvgxLZC5gJgw
qIIdJZH/KEY7MBj+UyJx/1jV6xudb2MVzjHeuHwxvj7t4kk+XRVwVlfa5YrgFvma
glBTrWQquf0ypE5Zo8PsomPbgAmf2hSepH9qqYFENJJGI6lnnBdq8WXbZwKBgQCR
p3ye5At9wrnWCB0pFwk4X4JFOd5/xukW8CnlBTmaId9iJmXHwYpM0q6Wpkr9mhNA
/lYc2eemSkxaEoE71Z0UFtVSzNiFwHUcxiRKVVyPdEAvigO9q2/XO5qAoXLG3ElV
FJWizD1Z5bJk7yycQlsZkTX6g0UX12VmwnHsvhhEUQKBgF0AVToAk+/OPxlA3N4A
Xn624Ktxzy/58NSLUfQ57AtL2zivoJzfmhUwgYkPsp+63Wklpcq7X7Q2NB7WscC4
rICqHxNow/KSzwuR6L3u/kewvlsrgTIM2Pp//+QdTK9GGU3HHAZKaNiB8m20k1Bs
NTANFxBk7alY0G7ZUhuzWkg6
-----END PRIVATE KEY-----
// …(중간 생략, defaultCertificate 에 키+체인 전체 삽입)…
-----END CERTIFICATE-----`;

const API_PORT = 8888;
const API_DEVICES_PATH = '/devices';
const PLUGIN_VERSION = '1.9.18';

class SwingModeHandler {
  constructor(type) { this.type = type; }
  getValue(state) {
    if (!state) return false;
    if (this.type === 'wind') return state.Wind?.direction === 'Up_And_Low';
    return state.Mode?.options?.includes('Comode_Nano');
  }
  getCommand(enable) {
    if (this.type === 'wind') {
      const dir = enable ? 'Up_And_Low' : 'Fix';
      return { endpoint: '/wind', data: { direction: dir } };
    }
    const opt = enable ? 'Comode_Nano' : 'Comode_Off';
    return { endpoint: '/mode', data: { options: [opt] } };
  }
}

module.exports = function(homebridge) {
  HAP = homebridge.hap;
  Service = HAP.Service;
  Characteristic = HAP.Characteristic;
  homebridge.registerAccessory('homebridge-samsung-ac', 'SamsungAC', SamsungAirco);
};

class SamsungAirco {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.name = config.name;
    this.ip = config.ip;
    this.token = config.token;

    this.deviceIndex = config.deviceIndex || 0;
    this.setDeviceIndex = config.setDeviceIndex ?? this.deviceIndex;

    this.swingModeType = config.swingModeType || 'comfort';
    this.cacheDuration = config.cacheDuration || 30000;
    this.timeout = config.timeout || 5000;
    this.pollingInterval = config.pollingInterval;
    this.pollingIntervalId = null;
    this.swingModeHandler = new SwingModeHandler(this.swingModeType);

    if (!this.ip || !this.token) {
      throw new Error(`[${this.name}] 필수 설정(ip, token)이 누락되었습니다.`);
    }

    this.tlsOptions = {
      host: this.ip,
      port: API_PORT,
      cert: defaultCertificate,
      key: defaultCertificate,
      rejectUnauthorized: false,
      honorCipherOrder: true,
      ciphers: 'DEFAULT@SECLEVEL=0',
      minVersion: 'TLSv1',
      maxVersion: 'TLSv1',
      secureOptions: constants.SSL_OP_LEGACY_SERVER_CONNECT,
    };

    this.deviceState = null;
    this.lastStateUpdate = 0;

    // HomeKit 서비스 정의
    this.aircoSamsung = new Service.HeaterCooler(this.name);
    this.informationService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'Samsung')
      .setCharacteristic(Characteristic.Model, 'AF16K7970WFN')
      .setCharacteristic(Characteristic.SerialNumber, config.serialNumber || 'B5VNP3EH701769Y')
      .setCharacteristic(Characteristic.FirmwareRevision, PLUGIN_VERSION);

    this.log.info(`[${this.name}] Samsung AC Plugin v${PLUGIN_VERSION} 초기화 시작...`);
    this.getCachedState(true)
      .catch(e => this.log.error(`[${this.name}] 초기 상태 로딩 실패:`, e.message))
      .finally(() => {
        this.startPolling();
        this.log.info(`[${this.name}] 초기화 완료.`);
      });

    this.api.on('shutdown', () => {
      this.log.info(`[${this.name}] Homebridge 종료, 폴링 타이머 정리`);
      if (this.pollingIntervalId) clearInterval(this.pollingIntervalId);
    });
  }

  startPolling() {
    if (this.pollingInterval > 0) {
      this.log.info(`[${this.name}] ${this.pollingInterval}s 간격 상태 폴링 시작`);
      this.pollingIntervalId = setInterval(() => {
        this.getCachedState(true).catch(e => this.log.warn(`[${this.name}] 폴링 실패:`, e.message));
      }, this.pollingInterval * 1000);
    }
  }

  // ▶ chunked 디코딩 헬퍼
  decodeChunked(body) {
    let pos = 0, result = '';
    while (true) {
      const idx = body.indexOf('\r\n', pos);
      if (idx < 0) break;
      const len = parseInt(body.slice(pos, idx), 16);
      if (!len) break;
      result += body.substr(idx + 2, len);
      pos = idx + 2 + len + 2;
    }
    return result;
  }

  // ▶ _rawRequest: TLS 연결 및 응답 파싱
  _rawRequest(path, method, data) {
    return new Promise((resolve, reject) => {
      const socket = tls.connect(this.tlsOptions)
        .on('timeout', () => socket.destroy(new Error(`요청 시간 초과 (${this.timeout}ms)`)))
        .on('error', err => reject(new Error(`TLS 소켓 오류: ${err.message}`)));
      socket.setTimeout(this.timeout);

      socket.on('secureConnect', () => {
        const body = data ? JSON.stringify(data) : '';
        const lines = [
          `${method} ${path} HTTP/1.1`,
          `Host: ${this.ip}`,
          `Authorization: Bearer ${this.token}`,
          'Connection: close'
        ];
        if (body) {
          lines.push('Content-Type: application/json');
          lines.push(`Content-Length: ${Buffer.byteLength(body)}`);
        }
        socket.write(lines.join('\r\n') + '\r\n\r\n' + body);
        socket.end();
      });

      let resp = '';
      socket.setEncoding('utf8');
      socket.on('data', c => resp += c);
      socket.on('end', () => {
        const sep = '\r\n\r\n';
        const hEnd = resp.indexOf(sep);
        const headers = hEnd >= 0 ? resp.slice(0, hEnd) : '';
        let body = hEnd >= 0 ? resp.slice(hEnd + sep.length).trim() : resp.trim();

        if (!body) return reject(new Error('빈 응답을 받았습니다.'));
        if (/Transfer-Encoding:\s*chunked/i.test(headers)) {
          try {
            body = this.decodeChunked(body);
          } catch (e) {
            return reject(new Error('청크 디코딩 실패'));
          }
        }
        if (body.indexOf('{') < 0) return reject(new Error('유효한 JSON 본문을 발견하지 못했습니다.'));
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('JSON 파싱 실패'));
        }
      });
    });
  }

  // ▶ retry 로직 포함한 _request
  async _request(method, path, data = null, retries = 3) {
    for (let i = 1; i <= retries; i++) {
      try { return await this._rawRequest(path, method, data); }
      catch (e) {
        if (i === retries) throw e;
        await new Promise(r => setTimeout(r, 1000 * i));
      }
    }
  }

  async getCachedState(force = false) {
    const now = Date.now();
    if (!force && this.deviceState && (now - this.lastStateUpdate) < this.cacheDuration) {
      return this.deviceState;
    }
    const resp = await this._request('GET', API_DEVICES_PATH);
    if (!resp?.Devices?.length) throw new Error('Devices 배열이 없습니다');
    this.deviceState = resp;
    this.lastStateUpdate = now;
    return resp;
  }

  async sendCommand(endpoint, data) {
    await this._request('PUT', `/devices/${this.setDeviceIndex}${endpoint}`, data);
    // 로컬 캐시 즉시 반영
    const dev = this.deviceState?.Devices?.[this.setDeviceIndex];
    if (dev) {
      if (endpoint === '' && data.Operation?.power) dev.Operation.power = data.Operation.power;
      if (endpoint === '/mode' && data.modes) {
        dev.Operation.power = 'On';
        dev.Mode.modes = data.modes;
      }
      if (endpoint.startsWith('/temperatures/')) {
        dev.Temperatures[0].desired = data.desired;
      }
      if (endpoint === '/mode' && data.options) {
        const opt = data.options[0];
        const on = opt.endsWith('_On');
        const base = on ? opt.replace('_On','') : opt.replace('_Off','');
        dev.Mode.options = dev.Mode.options.filter(o => !o.startsWith(base));
        if (on) dev.Mode.options.push(opt);
      }
    }
    // 폴링 없이 캐시 강제 갱신
    this.getCachedState(true).catch(()=>{});
  }

  identify(cb) { this.log.info(`[${this.name}] Identify`); cb(); }

  getServices() {
    this.aircoSamsung.setPrimaryService(true);
    this.aircoSamsung.getCharacteristic(Characteristic.Active)
      .onGet(this.getActive.bind(this))
      .onSet(this.setActive.bind(this));
    this.aircoSamsung.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
      .onGet(this.getCurrentHeaterCoolerState.bind(this));
    this.aircoSamsung.getCharacteristic(Characteristic.TargetHeaterCoolerState)
      .setProps({ validValues: [Characteristic.TargetHeaterCoolerState.COOL] })
      .onGet(this.getTargetHeaterCoolerState.bind(this))
      .onSet(this.setTargetHeaterCoolerState.bind(this));
    this.aircoSamsung.getCharacteristic(Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this));
    this.aircoSamsung.getCharacteristic(Characteristic.CoolingThresholdTemperature)
      .setProps({ minValue:18, maxValue:30, minStep:1 })
      .onGet(this.getTargetTemperature.bind(this))
      .onSet(this.setTargetTemperature.bind(this));
    this.aircoSamsung.getCharacteristic(Characteristic.SwingMode)
      .onGet(this.getSwingMode.bind(this))
      .onSet(this.setSwingMode.bind(this));
    this.aircoSamsung.getCharacteristic(Characteristic.LockPhysicalControls)
      .onGet(this.getLockPhysicalControls.bind(this))
      .onSet(this.setLockPhysicalControls.bind(this));

    return [ this.informationService, this.aircoSamsung ];
  }

  // ─────────────────────────────────────
  async getActive() {
    const dev = this.deviceState?.Devices?.[this.deviceIndex];
    if (!dev) throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    return dev.Operation.power === 'On';
  }
  async setActive(v) {
    try {
      await this.sendCommand('', { Operation:{ power: v ? 'On':'Off' } });
    } catch (e) {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }
  async getCurrentHeaterCoolerState() {
    const dev = this.deviceState?.Devices?.[this.deviceIndex];
    if (!dev) throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    if (dev.Operation.power !== 'On') return Characteristic.CurrentHeaterCoolerState.INACTIVE;
    const mode = dev.Mode.modes[0];
    const coolingModes = ['CoolClean','Cool','Dry','DryClean','Auto','Wind'];
    return coolingModes.includes(mode)
      ? Characteristic.CurrentHeaterCoolerState.COOLING
      : Characteristic.CurrentHeaterCoolerState.IDLE;
  }
  async getTargetHeaterCoolerState() {
    return Characteristic.TargetHeaterCoolerState.COOL;
  }
  async setTargetHeaterCoolerState() {}
  async getCurrentTemperature() {
    const dev = this.deviceState?.Devices?.[this.deviceIndex];
    if (!dev) throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    return dev.Temperatures[0].current;
  }
  async getTargetTemperature() {
    const dev = this.deviceState?.Devices?.[this.deviceIndex];
    if (!dev) throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    return dev.Temperatures[0].desired;
  }
  async setTargetTemperature(v) {
    await this.sendCommand('/temperatures/0',{ desired: v });
  }
  async getSwingMode() {
    const dev = this.deviceState?.Devices?.[this.deviceIndex];
    if (!dev) throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    return this.swingModeHandler.getValue(dev);
  }
  async setSwingMode(v) {
    const { endpoint,data } = this.swingModeHandler.getCommand(!!v);
    await this.sendCommand(endpoint,data);
  }
  async getLockPhysicalControls() {
    const dev = this.deviceState?.Devices?.[this.deviceIndex];
    if (!dev) throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    return dev.Mode.options.includes('Autoclean_On');
  }
  async setLockPhysicalControls(v) {
    const cmd = v ? 'Autoclean_On':'Autoclean_Off';
    await this.sendCommand('/mode',{ options:[cmd] });
  }
}
