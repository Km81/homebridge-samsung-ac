// Samsung Air Conditioner Homebridge Plugin
// Version 1.9.20 (Chunked Encoding 완벽 디코딩 및 성능 안정화)
'use strict';

const tls = require('tls');
const { constants } = require('crypto');

let HAP, Service, Characteristic;

const API_PORT = 8888;
const API_DEVICES_PATH = '/devices';
const PLUGIN_VERSION = '1.9.20';

// --- 헬퍼: 청크 인코딩된 body를 정확히 디코딩 ---
function decodeChunked(body) {
  let decoded = '';
  let pos = 0;
  while (true) {
    const idx = body.indexOf('\r\n', pos);
    if (idx < 0) break;
    const lenHex = body.slice(pos, idx).trim();
    const chunkLen = parseInt(lenHex, 16);
    if (!chunkLen) break;
    const start = idx + 2;
    decoded += body.substr(start, chunkLen);
    pos = start + chunkLen + 2;
  }
  return decoded;
}

// --- SwingMode 핸들러 ---
class SwingModeHandler {
  constructor(type) { this.type = type; }
  getValue(state) {
    if (!state) return false;
    if (this.type === 'wind') return state.Wind?.direction === 'Up_And_Low';
    return state.Mode?.options?.includes('Comode_Nano');
  }
  getCommand(enable) {
    if (this.type === 'wind') {
      return { endpoint: '/wind', data: { direction: enable ? 'Up_And_Low' : 'Fix' } };
    }
    return { endpoint: '/mode', data: { options: [ enable ? 'Comode_Nano' : 'Comode_Off' ] } };
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
    this.swingModeHandler = new SwingModeHandler(config.swingModeType || 'comfort');
    this.cacheDuration = config.cacheDuration || 30000;
    this.timeout = config.timeout || 5000;
    this.pollingInterval = config.pollingInterval || 60;

    if (!this.ip || !this.token) {
      throw new Error(`[${this.name}] 필수 설정(ip, token)이 누락되었습니다.`);
    }

    this.tlsOptions = {
      host: this.ip,
      port: API_PORT,
      cert: config.certificate || '',    // PEM 문자열
      key: config.privateKey  || '',     // PEM 문자열
      rejectUnauthorized: false,
      honorCipherOrder: true,
      ciphers: 'DEFAULT@SECLEVEL=0',
      minVersion: 'TLSv1',
      maxVersion: 'TLSv1',
      secureOptions: constants.SSL_OP_LEGACY_SERVER_CONNECT,
    };

    this.deviceState = null;
    this.lastStateUpdate = 0;

    this.aircoSamsung = new Service.HeaterCooler(this.name);
    this.informationService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'Samsung')
      .setCharacteristic(Characteristic.Model, 'AF16K7970WFN')
      .setCharacteristic(Characteristic.SerialNumber, config.serialNumber || 'Unknown')
      .setCharacteristic(Characteristic.FirmwareRevision, PLUGIN_VERSION);

    log.info(`[${this.name}] Samsung AC Plugin v${PLUGIN_VERSION} 초기화...`);
    this.getCachedState(true)
      .catch(e => log.error(`[${this.name}] 초기 상태 로딩 실패:`, e.message))
      .finally(() => {
        this.startPolling();
        log.info(`[${this.name}] 초기화 완료.`);
      });

    api.on('shutdown', () => {
      if (this.pollIntervalId) clearInterval(this.pollIntervalId);
      log.info(`[${this.name}] 폴링 타이머 정리 완료.`);
    });
  }

  startPolling() {
    if (this.pollingInterval > 0) {
      this.pollIntervalId = setInterval(() => {
        this.getCachedState(true)
          .catch(e => this.log.warn(`[${this.name}] 폴링 실패:`, e.message));
      }, this.pollingInterval * 1000);
    }
  }

  _rawRequest(path, method, data) {
    return new Promise((resolve, reject) => {
      const socket = tls.connect(this.tlsOptions)
        .on('timeout', () => socket.destroy(new Error(`요청 시간 초과 (${this.timeout}ms)`)))
        .on('error', err => reject(new Error(`TLS 오류: ${err.message}`)));

      socket.setTimeout(this.timeout);
      socket.on('secureConnect', () => {
        const body = data ? JSON.stringify(data) : '';
        const headers = [
          `${method} ${path} HTTP/1.1`,
          `Host: ${this.ip}`,
          `Authorization: Bearer ${this.token}`,
          'Connection: close',
          body && 'Content-Type: application/json',
          body && `Content-Length: ${Buffer.byteLength(body)}`
        ].filter(Boolean).join('\r\n') + '\r\n\r\n';
        socket.write(headers + body);
        socket.end();
      });

      let raw = '';
      socket.setEncoding('utf8');
      socket.on('data', chunk => raw += chunk);
      socket.on('end', () => {
        const sep = '\r\n\r\n';
        const idx = raw.indexOf(sep);
        const head = idx >= 0 ? raw.slice(0, idx) : '';
        let body = idx >= 0 ? raw.slice(idx + sep.length) : raw;

        if (/Transfer-Encoding:\s*chunked/i.test(head)) {
          try {
            body = decodeChunked(body);
          } catch (e) {
            return reject(new Error('청크 디코딩 실패'));
          }
        }

        body = body.trim();
        if (!body || body[0] !== '{') {
          return reject(new Error('빈 응답을 받았습니다.'));
        }

        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('JSON 파싱 실패'));
        }
      });
    });
  }

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
    if (!resp?.Devices) throw new Error('Devices 배열 없음');
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
      if (endpoint === '/mode' && data.options) {
        const opt = data.options[0];
        const base = opt.replace(/_(On|Off)$/, '');
        dev.Mode.options = dev.Mode.options.filter(o => !o.startsWith(base));
        if (opt.endsWith('_On')) dev.Mode.options.push(opt);
      }
      if (endpoint.startsWith('/temperatures/')) dev.Temperatures[0].desired = data.desired;
    }
  }

  identify(cb) { this.log.info(`[${this.name}] Identify`); cb(); }

  getServices() {
    this.aircoSamsung.setPrimaryService(true);
    const c = this.aircoSamsung.getCharacteristic.bind(this.aircoSamsung);

    c(Characteristic.Active)
      .onGet(() => this.getActive())
      .onSet(v => this.setActive(v));

    c(Characteristic.CurrentHeaterCoolerState)
      .onGet(() => this.getCurrentState());

    c(Characteristic.TargetHeaterCoolerState)
      .setProps({ validValues: [Characteristic.TargetHeaterCoolerState.COOL] })
      .onGet(() => Characteristic.TargetHeaterCoolerState.COOL)
      .onSet(v => this.log.debug('TargetState ignored'));

    c(Characteristic.CurrentTemperature)
      .onGet(() => this.getCurrentTemperature());

    c(Characteristic.CoolingThresholdTemperature)
      .setProps({ minValue: 18, maxValue: 30, minStep: 1 })
      .onGet(() => this.getTargetTemperature())
      .onSet(v => this.setTargetTemperature(v));

    c(Characteristic.SwingMode)
      .onGet(() => this.getSwingMode())
      .onSet(v => this.setSwingMode(v));

    c(Characteristic.LockPhysicalControls)
      .onGet(() => this.getLockPhysicalControls())
      .onSet(v => this.setLockPhysicalControls(v));

    return [ this.informationService, this.aircoSamsung ];
  }

  // --- Handlers ---
  async getActive() {
    const dev = this.deviceState.Devices[this.deviceIndex];
    if (!dev) throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    return dev.Operation.power === 'On';
  }
  async setActive(val) {
    await this.sendCommand('', { Operation: { power: val ? 'On' : 'Off' } });
  }

  async getCurrentState() {
    const dev = this.deviceState.Devices[this.deviceIndex];
    if (!dev) throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    if (dev.Operation.power !== 'On') return Characteristic.CurrentHeaterCoolerState.INACTIVE;
    const mode = dev.Mode.modes[0];
    const cooling = ['Cool','CoolClean','Dry','DryClean','Auto','Wind'].includes(mode);
    return cooling
      ? Characteristic.CurrentHeaterCoolerState.COOLING
      : Characteristic.CurrentHeaterCoolerState.IDLE;
  }

  async getCurrentTemperature() {
    return this.deviceState.Devices[this.deviceIndex].Temperatures[0].current;
  }

  async getTargetTemperature() {
    return this.deviceState.Devices[this.deviceIndex].Temperatures[0].desired;
  }
  async setTargetTemperature(val) {
    await this.sendCommand('/temperatures/0', { desired: val });
  }

  async getSwingMode() {
    return this.swingModeHandler.getValue(this.deviceState.Devices[this.deviceIndex]);
  }
  async setSwingMode(val) {
    const { endpoint, data } = this.swingModeHandler.getCommand(!!val);
    await this.sendCommand(endpoint, data);
  }

  async getLockPhysicalControls() {
    return this.deviceState.Devices[this.deviceIndex].Mode.options.includes('Autoclean_On');
  }
  async setLockPhysicalControls(val) {
    await this.sendCommand('/mode', { options: [ val ? 'Autoclean_On' : 'Autoclean_Off' ] });
  }
}
