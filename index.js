// Samsung Air Conditioner Homebridge Plugin
// Version 1.8.6 (ChatGPT 리뷰 기반 개선 버전)
'use strict';

const https = require('https');
const fs = require('fs');
// --- 개선점: 동시성 제어 ---
// 여러 요청이 동시에 상태를 변경하거나 조회할 때 발생할 수 있는 문제를 방지하기 위해 'async-lock' 라이브러리를 추가합니다.
// 이 플러그인을 사용하기 전에 `npm install async-lock` 명령어로 설치해야 합니다.
const AsyncLock = require('async-lock');

// --- 개선점: 스윙 모드 로직 분리 ---
// get/setSwingMode의 복잡한 로직을 별도의 클래스로 분리하여 코드의 가독성과 유지보수성을 높입니다.
class SwingModeHandler {
  constructor(type) {
    this.type = type;
  }

  /**
   * API 응답 상태로부터 스윙 모드 활성화 여부를 가져옵니다.
   * @param {object} state - 에어컨의 현재 상태 객체
   * @returns {boolean} - 활성화 여부
   */
  getValue(state) {
    if (!state) return false;
    if (this.type === 'wind') {
      return state.Wind?.direction === 'Up_And_Low';
    }
    return state.Mode?.options?.includes('Comode_Nano');
  }

  /**
   * 설정할 값에 따라 API에 보낼 명령을 생성합니다.
   * @param {boolean} enable - 활성화할지 여부
   * @returns {{endpoint: string, data: object}} - API 요청에 필요한 엔드포인트와 데이터
   */
  getCommand(enable) {
    if (this.type === 'wind') {
      const dir = enable ? 'Up_And_Low' : 'Fix';
      return { endpoint: '/wind', data: { direction: dir } };
    }
    const opt = enable ? 'Comode_Nano' : 'Comode_Off';
    return { endpoint: '/mode', data: { options: [opt] } };
  }
}


const API_PORT = 8888;
const API_DEVICES_PATH = '/devices';
const PLUGIN_VERSION = '1.8.6';

let Service, Characteristic, Accessory;

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  Accessory = homebridge.hap.Accessory;

  homebridge.registerAccessory('homebridge-samsung-ac', 'SamsungAC', SamsungAirco);
};

class SamsungAirco {
  constructor(log, config) {
    this.log = log;

    // 설정 값 불러오기
    this.name = config.name;
    this.ip = config.ip;
    this.token = config.token;
    // --- 개선점: 인증서와 키 분리 ---
    // cert와 key를 별도 파일로 관리할 수 있도록 설정 항목을 분리합니다.
    this.certPath = config.certPath;
    this.keyPath = config.keyPath || config.certPath; // keyPath가 없으면 certPath를 사용해 하위 호환성 유지
    
    this.deviceIndex = config.deviceIndex || 0;
    this.setDeviceIndex = config.setDeviceIndex ?? this.deviceIndex;
    this.swingModeType = config.swingModeType || 'comfort';
    this.cacheDuration = config.cacheDuration || 30000;
    // --- 개선점: 사용자 정의 타임아웃 ---
    this.timeout = config.timeout || 5000;
    // --- 개선점: 상태 폴링 ---
    this.pollingInterval = config.pollingInterval;

    // 동시성 제어를 위한 Lock 인스턴스 생성
    this.lock = new AsyncLock();
    // 스윙 모드 제어를 위한 핸들러 인스턴스 생성
    this.swingModeHandler = new SwingModeHandler(this.swingModeType);

    // 필수 설정값 유효성 검사
    if (!this.ip || !this.token || !this.certPath) {
      this.log.error('IP, 토큰, 인증서 경로(certPath)는 필수 설정 항목입니다.');
      return;
    }

    // 인증서/키 파일 존재 및 읽기 권한 확인
    try {
      fs.accessSync(this.certPath, fs.constants.R_OK);
      fs.accessSync(this.keyPath, fs.constants.R_OK);
    } catch (e) {
      this.log.error(`[오류] 인증서 또는 키 파일을 찾을 수 없거나 읽을 수 없습니다. (오류: ${e.message})`);
      return;
    }

    // --- 개선점: Node.js 호환성을 위한 TLS 옵션 현대화 ---
    // secureProtocol 대신 minVersion을 사용하여 최신 Node.js와의 호환성을 높입니다.
    this.httpsAgent = new https.Agent({
      cert: fs.readFileSync(this.certPath),
      key: fs.readFileSync(this.keyPath),
      rejectUnauthorized: false,
      ciphers: 'DEFAULT@SECLEVEL=1',
      minVersion: 'TLSv1',
    });

    this.deviceState = null;
    this.lastStateUpdate = 0;

    this.aircoSamsung = new Service.HeaterCooler(this.name);
    this.informationService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'Samsung')
      .setCharacteristic(Characteristic.Model, 'Air Conditioner')
      .setCharacteristic(Characteristic.SerialNumber, config.serialNumber || 'AF16K7970WFN');

    this.log.info(`Samsung AC Plugin v${PLUGIN_VERSION} 초기화 완료: ${this.name}`);

    // --- 개선점: 상태 폴링 기능 추가 ---
    // 리모컨 등 외부에서 상태가 변경되는 경우를 감지하기 위해 주기적으로 상태를 가져옵니다.
    if (this.pollingInterval && this.pollingInterval > 0) {
      this.log.info(`[POLLING] ${this.pollingInterval}초 간격으로 상태 폴링을 시작합니다.`);
      setInterval(() => {
        this.log.debug('[POLLING] 주기적인 상태 업데이트 실행...');
        // getCachedState는 이미 Lock으로 보호되므로 안전하게 호출할 수 있습니다.
        this.getCachedState().catch(e => {
          this.log.error(`[POLLING] 상태 자동 갱신 실패: ${e.message}`);
        });
      }, this.pollingInterval * 1000);
    }
  }

  /**
   * API 요청을 보내는 내부 함수 (재시도 로직 추가)
   * @param {string} method - HTTP 메서드
   * @param {string} path - 요청 경로
   * @param {object|null} data - 전송할 데이터
   * @param {number} retries - 최대 재시도 횟수
   * @returns {Promise<object>} - 서버 응답
   */
  async _request(method, path, data = null, retries = 3) {
    // --- 개선점: HTTP 요청 재시도 로직 ---
    // 네트워크 불안정이나 일시적인 장치 응답 지연에 대응하여 안정성을 높입니다.
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await new Promise((resolve, reject) => {
          const options = {
            hostname: this.ip,
            port: API_PORT,
            path,
            method,
            headers: { Authorization: `Bearer ${this.token}` },
            agent: this.httpsAgent,
            timeout: this.timeout, // 사용자 정의 타임아웃 적용
          };

          if (data) {
            const postData = JSON.stringify(data);
            options.headers['Content-Type'] = 'application/json';
            options.headers['Content-Length'] = Buffer.byteLength(postData);
          }

          const req = https.request(options, (res) => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              return reject(new Error(`요청 실패, 상태 코드: ${res.statusCode}`));
            }
            const body = [];
            res.on('data', (chunk) => body.push(chunk));
            res.on('end', () => {
              try {
                resolve(JSON.parse(Buffer.concat(body).toString() || '{}'));
              } catch (e) {
                reject(e);
              }
            });
          });

          req.on('error', reject);
          req.on('timeout', () => {
            req.destroy();
            reject(new Error('요청 시간 초과'));
          });

          if (data) req.write(JSON.stringify(data));
          req.end();
        });
      } catch (e) {
        if (attempt === retries) {
          this.log.error(`[HTTP] 최종 요청 실패 (${attempt}회 시도): ${e.message}`);
          throw e;
        }
        this.log.warn(`[HTTP] 요청 실패, 재시도 ${attempt}/${retries}... (${e.message})`);
        // 재시도 간격을 점차 늘립니다.
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  /**
   * 에어컨의 현재 상태를 가져오는 함수 (동시성 제어 및 API 응답 검증 추가)
   * @returns {Promise<object>} - 에어컨 상태 정보
   */
  async getCachedState() {
    // Lock을 사용하여 동시에 여러 getCachedState 호출이 일어나 API 요청이 중복되는 것을 방지합니다.
    return this.lock.acquire('state-update', async () => {
      const now = Date.now();
      if (this.deviceState && now - this.lastStateUpdate < this.cacheDuration) {
        this.log.debug('[CACHE] 유효한 캐시 사용');
        return this.deviceState;
      }

      this.log.info('[CACHE] 캐시 만료, 새 상태 요청');
      try {
        const { Devices } = await this._request('GET', API_DEVICES_PATH);

        // --- 개선점: API 응답 검증 ---
        // API 응답 구조가 예상과 다른 경우 오류를 발생시켜 플러그인의 비정상 종료를 방지합니다.
        if (!Devices || !Array.isArray(Devices) || !Devices[this.deviceIndex]) {
          this.log.error(`[API] 응답에서 유효한 장치를 찾을 수 없습니다 (Index: ${this.deviceIndex}). 응답: ${JSON.stringify(Devices)}`);
          throw new Error(`Device at index ${this.deviceIndex} not found in API response.`);
        }
        
        this.deviceState = Devices[this.deviceIndex];
        this.lastStateUpdate = now;
        this.log.info('[CACHE] 캐시 업데이트 완료');
        return this.deviceState;
      } catch (e) {
        this.log.error(`[CACHE] 상태 조회 실패: ${e.message}`);
        if (this.deviceState) {
          this.log.warn('[CACHE] API 오류 발생. 오래된 캐시 데이터 반환');
          return this.deviceState;
        }
        throw e;
      }
    });
  }

  /**
   * 에어컨에 제어 명령을 보내는 함수 (동시성 제어 적용)
   * @param {string} endpoint - 제어할 기능의 엔드포인트
   * @param {object} data - 전송할 제어 데이터
   */
  async sendCommand(endpoint, data) {
    // Lock을 사용하여 상태를 변경하는 동안 다른 요청이 끼어드는 것을 방지합니다.
    return this.lock.acquire('state-update', async () => {
      this.log.info(`[COMMAND] ${endpoint} -> ${JSON.stringify(data)}`);
      const fullPath = `/devices/${this.setDeviceIndex}${endpoint}`;
      await this._request('PUT', fullPath, data);
      this.log.info('[COMMAND] 전송 완료');
      
      // 명령 전송 후, 상태가 변경되었으므로 로컬 캐시를 무효화합니다.
      // 다음 getCachedState 호출 시 새로운 상태를 강제로 가져오게 됩니다.
      this.deviceState = null;
    });
  }
  
  identify() { this.log.info('[IDENTIFY] 호출됨'); }

  getServices() {
    this.aircoSamsung.setPrimaryService(true);

    // 각 특성에 대한 핸들러를 등록합니다.
    // 모든 핸들러는 Promise를 반환하는 최신 방식으로 작성되었습니다.
    this.aircoSamsung.getCharacteristic(Characteristic.Active)
      .on('get', this.getActive.bind(this)).on('set', this.setActive.bind(this));
    this.aircoSamsung.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
      .on('get', this.getCurrentHeaterCoolerState.bind(this));
    this.aircoSamsung.getCharacteristic(Characteristic.TargetHeaterCoolerState)
      .setProps({ validValues: [Characteristic.TargetHeaterCoolerState.COOL] })
      .on('get', this.getTargetHeaterCoolerState.bind(this)).on('set', this.setTargetHeaterCoolerState.bind(this));
    this.aircoSamsung.getCharacteristic(Characteristic.CurrentTemperature)
      .on('get', this.getCurrentTemperature.bind(this));
    this.aircoSamsung.getCharacteristic(Characteristic.CoolingThresholdTemperature)
      .setProps({ minValue: 18, maxValue: 30, minStep: 1 })
      .on('get', this.getTargetTemperature.bind(this)).on('set', this.setTargetTemperature.bind(this));
    this.aircoSamsung.getCharacteristic(Characteristic.SwingMode)
      .on('get', this.getSwingMode.bind(this)).on('set', this.setSwingMode.bind(this));
    this.aircoSamsung.getCharacteristic(Characteristic.LockPhysicalControls)
      .on('get', this.getLockPhysicalControls.bind(this)).on('set', this.setLockPhysicalControls.bind(this));

    return [this.informationService, this.aircoSamsung];
  }

  // --- Characteristic Handlers ---
  // 모든 핸들러는 에러 발생 시 홈 앱에 명확한 오류를 전달하기 위해 HapStatusError를 사용합니다.

  async getActive() {
    try {
      const state = await this.getCachedState();
      return state.Operation?.power === 'On' ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;
    } catch (e) {
      this.log.error('[GET] Active 오류:', e.message);
      throw new Characteristic.hap.HapStatusError(Characteristic.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async setActive(value) {
    const target = value === Characteristic.Active.ACTIVE ? 'On' : 'Off';
    try {
      await this.sendCommand('', { Operation: { power: target } });
      this.log.info(`[SET] Active 설정 완료: ${target}`);
    } catch (e) {
      this.log.error('[SET] Active 오류:', e.message);
      throw new Characteristic.hap.HapStatusError(Characteristic.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }
  
  async getCurrentTemperature() {
    try {
      const state = await this.getCachedState();
      return state.Temperatures[0].current;
    } catch (e) {
      this.log.error('[GET] CurrentTemperature 오류:', e.message);
      throw new Characteristic.hap.HapStatusError(Characteristic.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getTargetTemperature() {
    try {
      const state = await this.getCachedState();
      return state.Temperatures[0].desired;
    } catch (e) {
      this.log.error('[GET] TargetTemperature 오류:', e.message);
      throw new Characteristic.hap.HapStatusError(Characteristic.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async setTargetTemperature(value) {
    try {
      await this.sendCommand('/temperatures/0', { desired: value });
      this.log.info(`[SET] TargetTemperature 설정 완료: ${value}°C`);
    } catch (e) {
      this.log.error('[SET] TargetTemperature 오류:', e.message);
      throw new Characteristic.hap.HapStatusError(Characteristic.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getSwingMode() {
    try {
      const state = await this.getCachedState();
      const enabled = this.swingModeHandler.getValue(state);
      return enabled ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED;
    } catch (e) {
      this.log.error('[GET] SwingMode 오류:', e.message);
      throw new Characteristic.hap.HapStatusError(Characteristic.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async setSwingMode(value) {
    const enable = value === Characteristic.SwingMode.SWING_ENABLED;
    try {
      const { endpoint, data } = this.swingModeHandler.getCommand(enable);
      await this.sendCommand(endpoint, data);
      this.log.info(`[SET] SwingMode 설정 완료: ${enable ? 'ENABLED' : 'DISABLED'}`);
    } catch (e) {
      this.log.error('[SET] SwingMode 오류:', e.message);
      throw new Characteristic.hap.HapStatusError(Characteristic.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }
  
  async getLockPhysicalControls() {
    try {
      const state = await this.getCachedState();
      const locked = state.Mode?.options?.includes('Autoclean_On');
      return locked ? Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED : Characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED;
    } catch (e) {
      this.log.error('[GET] LockPhysicalControls 오류:', e.message);
      throw new Characteristic.hap.HapStatusError(Characteristic.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async setLockPhysicalControls(value) {
    const action = value === Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED ? 'Autoclean_On' : 'Autoclean_Off';
    try {
      await this.sendCommand('/mode', { options: [action] });
      this.log.info(`[SET] LockPhysicalControls 설정 완료: ${action}`);
    } catch (e) {
      this.log.error('[SET] LockPhysicalControls 오류:', e.message);
      throw new Characteristic.hap.HapStatusError(Characteristic.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getCurrentHeaterCoolerState() {
    try {
      const state = await this.getCachedState();
      const mode = state.Mode?.modes[0];
      const cooling = ['CoolClean', 'Cool', 'Dry', 'DryClean', 'Auto', 'Wind'].includes(mode);
      return cooling ? Characteristic.CurrentHeaterCoolerState.COOLING : Characteristic.CurrentHeaterCoolerState.IDLE;
    } catch (e) {
      this.log.error('[GET] CurrentHeaterCoolerState 오류:', e.message);
      throw new Characteristic.hap.HapStatusError(Characteristic.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  getTargetHeaterCoolerState() {
    return this.getCurrentHeaterCoolerState();
  }

  setTargetHeaterCoolerState(value) {
    this.log.info('[SET] TargetHeaterCoolerState 호출 무시');
  }
}
