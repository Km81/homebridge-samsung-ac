// Samsung Air Conditioner Homebridge Plugin
// Version 1.9.4 (Final Compatibility Patch for modern Node.js)
'use strict';

const tls = require('tls');
const fs = require('fs');
const { constants } = require('crypto');

let HAP;
let Service, Characteristic;

const API_PORT = 8888;
const API_DEVICES_PATH = '/devices';
const PLUGIN_VERSION = '1.9.4';

/**
 * 스윙 모드(컴포트/무풍)를 처리하는 헬퍼 클래스
 */
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

/**
 * 삼성 에어컨 액세서리 클래스
 */
class SamsungAirco {
  constructor(log, config) {
    this.log = log;
    this.name = config.name;
    this.ip = config.ip;
    this.token = config.token;
    this.certPath = config.certPath || config.patchCert;
    this.keyPath = config.keyPath || this.certPath;
    this.deviceIndex = config.deviceIndex || 0;
    this.setDeviceIndex = config.setDeviceIndex ?? this.deviceIndex;
    this.swingModeType = config.swingModeType || 'comfort';
    this.cacheDuration = config.cacheDuration || 30000;
    this.timeout = config.timeout || 5000;
    this.pollingInterval = config.pollingInterval;
    this.swingModeHandler = new SwingModeHandler(this.swingModeType);

    if (!this.ip || !this.token || !this.certPath) {
      throw new Error(`[${this.name}] 필수 설정(ip, token, certPath)이 누락되었습니다.`);
    }

    try {
      fs.accessSync(this.certPath, fs.constants.R_OK);
      fs.accessSync(this.keyPath, fs.constants.R_OK);
    } catch (e) {
      throw new Error(`[${this.name}] 인증서/키 파일 접근 오류: ${e.message}`);
    }

    // --- TLS 호환성을 위한 핵심 설정 객체 ---
    // 최신 Node.js 환경에서 구형 TLSv1 에어컨과 통신하기 위한 모든 옵션을 여기에 정의합니다.
    this.tlsOptions = {
      host: this.ip,
      port: API_PORT,
      cert: fs.readFileSync(this.certPath),
      key: fs.readFileSync(this.keyPath),
      rejectUnauthorized: false, // 사설 인증서 허용
      honorCipherOrder: true,    // 서버(에어컨)가 제안하는 암호화 방식 순서 존중
      ciphers: 'DEFAULT@SECLEVEL=0', // 보안 레벨을 낮춰 오래된 암호화 방식 허용
      minVersion: 'TLSv1',         // 최소 TLS 버전을 1.0으로 고정
      maxVersion: 'TLSv1',         // 최대 TLS 버전을 1.0으로 고정
      // 'ca md too weak' 오류를 해결하기 위한 핵심 옵션. 레거시 서버 연결 허용.
      secureOptions: constants.SSL_OP_LEGACY_SERVER_CONNECT,
    };

    this.deviceState = null;
    this.lastStateUpdate = 0;

    this.aircoSamsung = new Service.HeaterCooler(this.name);
    this.informationService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'Samsung')
      .setCharacteristic(Characteristic.Model, 'AF16K7970WFN')
      .setCharacteristic(Characteristic.SerialNumber, config.serialNumber || 'B5VNP3EH701769Y')
      .setCharacteristic(Characteristic.FirmwareRevision, PLUGIN_VERSION);

    this.startPolling();
    this.log.info(`[${this.name}] Samsung AC Plugin v${PLUGIN_VERSION} 초기화 완료 (레거시 호환 모드)`);
  }

  startPolling() {
    if (this.pollingInterval > 0) {
      this.log.info(`[${this.name}] ${this.pollingInterval}초 간격으로 상태 폴링을 시작합니다.`);
      setInterval(() => {
        this.log.debug(`[${this.name}] 주기적인 상태 업데이트 실행...`);
        this.getCachedState(true).catch(e => this.log.error(`[${this.name}] 폴링 실패:`, e.message));
      }, this.pollingInterval * 1000);
    }
  }

  /**
   * Node.js의 HTTP 파서를 우회하고 저수준 TLS 소켓을 통해 직접 통신합니다.
   * 비표준 HTTP 응답을 보내는 구형 장비와의 호환성을 위해 이 방법을 사용합니다.
   * @param {string} path - 요청 경로 (예: /devices)
   * @param {string} method - HTTP 메소드 (예: GET, PUT)
   * @param {object} data - 전송할 데이터 (PUT 요청 시)
   * @returns {Promise<object>} - 파싱된 JSON 응답
   */
  _rawRequest(path, method, data) {
    return new Promise((resolve, reject) => {
      const socket = tls.connect(this.tlsOptions, () => {
        // HTTP/1.0 형식의 헤더를 수동으로 작성합니다.
        // 'Connection: close' 헤더는 'Parse Error'를 방지하는 데 매우 중요합니다.
        const requestData = [
          `${method} ${path} HTTP/1.0`,
          `Authorization: Bearer ${this.token}`,
          'Connection: close',
          '\r\n' // 헤더의 끝을 알리는 빈 줄
        ].join('\r\n');
        
        socket.write(requestData);
        if (data) {
          socket.write(JSON.stringify(data));
        }
      });

      let responseChunks = '';
      socket.setEncoding('utf8');
      socket.on('data', chunk => {
        responseChunks += chunk;
      });
      socket.on('end', () => {
        // 에어컨이 보내는 응답에서 HTTP 헤더 부분을 무시하고,
        // 첫 번째 '{' 문자부터 시작하는 JSON 데이터만 찾아서 파싱합니다.
        const jsonStartIndex = responseChunks.indexOf('{');
        if (jsonStartIndex < 0) {
          return reject(new Error(`응답에서 유효한 JSON을 찾지 못했습니다. 응답 내용: ${responseChunks}`));
        }
        try {
          const jsonResponse = JSON.parse(responseChunks.slice(jsonStartIndex));
          resolve(jsonResponse);
        } catch (e) {
          reject(new Error(`JSON 파싱에 실패했습니다: ${e.message}`));
        }
      });
      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('요청 시간 초과'));
      });
      socket.on('error', (err) => {
        reject(new Error(`TLS 소켓 오류: ${err.message}`));
      });
    });
  }

  async _request(method, path, data = null, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await this._rawRequest(path, method, data);
      } catch (e) {
        if (attempt === retries) {
          this.log.error(`[${this.name}] 최종 요청 실패 (${attempt}회 시도): ${e.message}`);
          throw e;
        }
        this.log.warn(`[${this.name}] 요청 실패, 재시도 ${attempt}/${retries}... (${e.message})`);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  async getCachedState(force = false) {
    const now = Date.now();
    if (!force && this.deviceState && (now - this.lastStateUpdate < this.cacheDuration)) {
      return this.deviceState;
    }
    const response = await this._request('GET', API_DEVICES_PATH);
    if (!response || !response.Devices || !Array.isArray(response.Devices) || !response.Devices[this.deviceIndex]) {
      throw new Error(`API 응답에서 장치(index: ${this.deviceIndex})를 찾을 수 없습니다.`);
    }
    this.deviceState = response.Devices[this.deviceIndex];
    this.lastStateUpdate = now;
    return this.deviceState;
  }

  async sendCommand(endpoint, data) {
    await this._request('PUT', `/devices/${this.setDeviceIndex}${endpoint}`, data);
    this.deviceState = null; // 명령 전송 후 캐시 무효화
    await this.getCachedState(true); // 즉시 상태 갱신
  }

  identify(callback) {
    this.log.info(`[${this.name}] Identify 호출됨.`);
    callback();
  }

  getServices() {
    this.aircoSamsung.setPrimaryService(true);

    this.aircoSamsung.getCharacteristic(Characteristic.Active)
      .onGet(this.getActive.bind(this))
      .onSet(this.setActive.bind(this));

    this.aircoSamsung.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
      .onGet(this.getCurrentHeaterCoolerState.bind(this));

    this.aircoSamsung.getCharacteristic(Characteristic.TargetHeaterCoolerState)
      .setProps({ validValues: [Characteristic.TargetHeaterCoolerState.COOL] })
      .onGet(this.getTargetHeaterCoolerState.bind(this));
      
    this.aircoSamsung.getCharacteristic(Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this));

    this.aircoSamsung.getCharacteristic(Characteristic.CoolingThresholdTemperature)
      .setProps({ minValue: 18, maxValue: 30, minStep: 1 })
      .onGet(this.getTargetTemperature.bind(this))
      .onSet(this.setTargetTemperature.bind(this));

    this.aircoSamsung.getCharacteristic(Characteristic.SwingMode)
      .onGet(this.getSwingMode.bind(this))
      .onSet(this.setSwingMode.bind(this));

    this.aircoSamsung.getCharacteristic(Characteristic.LockPhysicalControls)
      .onGet(this.getLockPhysicalControls.bind(this))
      .onSet(this.setLockPhysicalControls.bind(this));
      
    return [this.informationService, this.aircoSamsung];
  }

  // --- Characteristic Handlers ---
  // 가독성을 위해 표준 async/await 및 try/catch 형태로 정리
  
  async getActive() {
    try {
      const state = await this.getCachedState();
      return state.Operation.power === 'On' ? 1 : 0;
    } catch (e) {
      this.log.error(`[${this.name}] Active 상태 GET 오류:`, e.message);
      throw e;
    }
  }

  async setActive(value) {
    try {
      const powerCmd = value ? 'On' : 'Off';
      await this.sendCommand('', { Operation: { power: powerCmd } });
    } catch (e) {
      this.log.error(`[${this.name}] Active 상태 SET 오류:`, e.message);
      throw e;
    }
  }

  async getCurrentHeaterCoolerState() {
    try {
      const state = await this.getCachedState();
      const mode = state.Mode.modes[0];
      const isCooling = ['CoolClean', 'Cool', 'Dry', 'DryClean', 'Auto', 'Wind'].includes(mode);
      return isCooling ? Characteristic.CurrentHeaterCoolerState.COOLING : Characteristic.CurrentHeaterCoolerState.IDLE;
    } catch (e) {
      this.log.error(`[${this.name}] CurrentState GET 오류:`, e.message);
      throw e;
    }
  }
  
  async getTargetHeaterCoolerState() {
    return this.getCurrentHeaterCoolerState();
  }
  
  async getCurrentTemperature() {
    try {
      const state = await this.getCachedState();
      return state.Temperatures[0].current;
    } catch (e) {
      this.log.error(`[${this.name}] CurrentTemp GET 오류:`, e.message);
      throw e;
    }
  }

  async getTargetTemperature() {
    try {
      const state = await this.getCachedState();
      return state.Temperatures[0].desired;
    } catch (e) {
      this.log.error(`[${this.name}] TargetTemp GET 오류:`, e.message);
      throw e;
    }
  }
  
  async setTargetTemperature(value) {
    try {
      await this.sendCommand('/temperatures/0', { desired: value });
    } catch (e) {
      this.log.error(`[${this.name}] TargetTemp SET 오류:`, e.message);
      throw e;
    }
  }
  
  async getSwingMode() {
    try {
      const state = await this.getCachedState();
      return this.swingModeHandler.getValue(state) ? 1 : 0;
    } catch (e) {
      this.log.error(`[${this.name}] SwingMode GET 오류:`, e.message);
      throw e;
    }
  }

  async setSwingMode(value) {
    try {
      const { endpoint, data } = this.swingModeHandler.getCommand(value);
      await this.sendCommand(endpoint, data);
    } catch (e) {
      this.log.error(`[${this.name}] SwingMode SET 오류:`, e.message);
      throw e;
    }
  }

  async getLockPhysicalControls() {
    try {
      const state = await this.getCachedState();
      return state.Mode.options.includes('Autoclean_On') ? 1 : 0;
    } catch (e) {
      this.log.error(`[${this.name}] LockControls GET 오류:`, e.message);
      throw e;
    }
  }

  async setLockPhysicalControls(value) {
    try {
      const cmd = value ? 'Autoclean_On' : 'Autoclean_Off';
      await this.sendCommand('/mode', { options: [cmd] });
    } catch (e) {
      this.log.error(`[${this.name}] LockControls SET 오류:`, e.message);
      throw e;
    }
  }
}
