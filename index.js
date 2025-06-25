// Version 1.5.4
'use strict';

const https = require('https');
const fs = require('fs');

let Service, Characteristic, Accessory;

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  Accessory = homebridge.hap.Accessory;
  homebridge.registerAccessory('homebridge-samsung-ac', 'SamsungAC', SamsungAirco);
}

class SamsungAirco {
  constructor(log, config) {
    this.log = log;
    this.name = config.name;
    this.ip = config.ip;
    this.token = config.token;
    this.patchCert = config.patchCert;
    this.deviceIndex = config.deviceIndex || 0;
    this.setDeviceIndex = config.setDeviceIndex ?? this.deviceIndex;
    this.swingModeType = config.swingModeType || 'comfort';
    // 기본 캐시 시간 10초로 증가
    this.cacheDuration = config.cacheDuration || 10000;

    this.log.info(`[${this.name}] 플러그인 초기화 중... 버전 1.5.4`);

    if (!this.ip || !this.token || !this.patchCert) {
      this.log.error(`[${this.name}] IP, 토큰, 인증서 경로는 필수 설정 항목입니다.`);
      return;
    }

    this.httpsAgent = new https.Agent({
      keepAlive: true,                     // TLS 소켓 재활용
      cert: fs.readFileSync(this.patchCert),
      key:  fs.readFileSync(this.patchCert),
      rejectUnauthorized: false,
      ciphers: 'DEFAULT@SECLEVEL=1',
      secureProtocol: 'TLSv1_method'
    });

    this.deviceState = {
      Operation: { power: 'Off' },
      Temperatures: [{ current: 25, desired: 25 }],
      Mode: { modes: ['Cool'], options: [] },
      Wind: { direction: 'Fix' }
    };
    this.lastStateUpdate = 0;
    this.isFetching = false;

    this.aircoSamsung = new Service.HeaterCooler(this.name);
    this.informationService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'Samsung')
      .setCharacteristic(Characteristic.Model, 'Air Conditioner')
      .setCharacteristic(Characteristic.SerialNumber, config.serialNumber || 'AF16K7970WFN');

    // 기본값이라도 즉시 HomeKit에 표시
    this.pushStateToHomeKit();

    // 실제 기기 상태 백그라운드 갱신
    this.getAndUpdateStateInBackground('초기화');
  }

  _request(method, path, data = null) {
    this.log.debug(`[${this.name}] [REQUEST] --> ${method} ${path}`);
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.ip,
        port: 8888,
        path,
        method,
        headers: { 'Authorization': `Bearer ${this.token}` },
        agent: this.httpsAgent,
        timeout: 5000
      };
      let postData;
      if (data) {
        postData = JSON.stringify(data);
        options.headers['Content-Type'] = 'application/json';
        options.headers['Content-Length'] = Buffer.byteLength(postData);
      }
      const req = https.request(options, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`요청 실패, 상태 코드: ${res.statusCode}`));
        }
        let body = [];
        res.on('data', chunk => body.push(chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(body).toString() || '{}');
            this.log.debug(`[${this.name}] [RESPONSE] <-- ${method} ${path} 성공`);
            resolve(parsed);
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', e => reject(e));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('요청 시간 초과'));
      });
      if (postData) req.write(postData);
      req.end();
    });
  }

  async getAndUpdateStateInBackground(caller = '배경 업데이트') {
    if (this.isFetching) {
      this.log.debug(`[${this.name}] '${caller}' 요청: 이미 업데이트 중이므로 건너뜁니다.`);
      return;
    }
    this.log.info(`[${this.name}] '${caller}': 실제 기기 상태를 가져옵니다...`);
    this.isFetching = true;
    try {
      const res = await this._request('GET', '/devices');
      if (res && res.Devices && res.Devices[this.deviceIndex]) {
        this.deviceState = res.Devices[this.deviceIndex];
        this.lastStateUpdate = Date.now();
        this.log.info(`[${this.name}] 배경 업데이트 성공. UI에 푸시합니다.`);
        this.pushStateToHomeKit();
      }
    } catch (err) {
      this.log.error(`[${this.name}] 배경 상태 업데이트 실패: ${err.message}`);
    } finally {
      this.isFetching = false;
    }
  }

  pushStateToHomeKit() {
    if (!this.deviceState) return;
    this.log.info(`[${this.name}] --- HomeKit UI 푸시 시작 ---`);
    const { Active, CurrentTemperature, CoolingThresholdTemperature, CurrentHeaterCoolerState, SwingMode, LockPhysicalControls } = Characteristic;

    const power = this.deviceState.Operation.power === 'On';
    this.aircoSamsung.updateCharacteristic(Active, power);
    this.log.debug(`[PUSH] 전원: ${power}`);

    const curTemp = this.deviceState.Temperatures[0].current;
    this.aircoSamsung.updateCharacteristic(CurrentTemperature, curTemp);
    this.log.debug(`[PUSH] 현재 온도: ${curTemp}`);

    const tgtTemp = this.deviceState.Temperatures[0].desired;
    this.aircoSamsung.updateCharacteristic(CoolingThresholdTemperature, tgtTemp);
    this.log.debug(`[PUSH] 목표 온도: ${tgtTemp}`);

    const coolModes = ["CoolClean","Cool","Dry","DryClean","Auto","Wind"];
    const state = (power && coolModes.includes(this.deviceState.Mode.modes[0]))
      ? CurrentHeaterCoolerState.COOLING
      : CurrentHeaterCoolerState.IDLE;
    this.aircoSamsung.updateCharacteristic(CurrentHeaterCoolerState, state);
    this.log.debug(`[PUSH] 운전 상태: ${state === 2 ? '냉방' : '대기'}`);

    const swingOn = (this.swingModeType === 'wind')
      ? this.deviceState.Wind.direction === "Up_And_Low"
      : this.deviceState.Mode.options.includes("Comode_Nano");
    this.aircoSamsung.updateCharacteristic(SwingMode, swingOn);
    this.log.debug(`[PUSH] ${this.swingModeType} 모드: ${swingOn}`);

    const autoClean = this.deviceState.Mode.options.includes("Autoclean_On");
    this.aircoSamsung.updateCharacteristic(LockPhysicalControls, autoClean);
    this.log.debug(`[PUSH] 자동 청소: ${autoClean}`);

    this.log.info(`[${this.name}] --- HomeKit UI 푸시 완료 ---`);
  }

  handleGet(callback, caller, extractor) {
    const val = extractor(this.deviceState);
    this.log.info(`[${this.name}] [GET] '${caller}' 요청, 캐시 값: ${val}`);
    callback(null, val);
    if (Date.now() - this.lastStateUpdate > this.cacheDuration) {
      this.getAndUpdateStateInBackground(caller);
    }
  }

  async sendCommand(endpoint, data) {
    const path = `/devices/${this.setDeviceIndex}${endpoint}`;
    await this._request('PUT', path, data);
    this.lastStateUpdate = 0;  // 강제 갱신 트리거
    setTimeout(() => this.getAndUpdateStateInBackground(`명령 후 업데이트(${endpoint})`), 1500);
  }

  identify(callback) {
    this.log.info(`[${this.name}] 식별 요청 받음`);
    callback();
  }

  getServices() {
    this.aircoSamsung.setPrimaryService(true);
    const { Active, CurrentHeaterCoolerState, TargetHeaterCoolerState, CurrentTemperature, CoolingThresholdTemperature, SwingMode, LockPhysicalControls } = Characteristic;

    this.aircoSamsung.getCharacteristic(Active)
      .on('get', cb => this.handleGet(cb, '전원', s => s.Operation.power === "On"))
      .on('set', this.setActive.bind(this));

    this.aircoSamsung.getCharacteristic(CurrentHeaterCoolerState)
      .on('get', cb => this.handleGet(cb, '현재 운전 모드', s => {
        const modes = ["CoolClean","Cool","Dry","DryClean","Auto","Wind"];
        return (s.Operation.power==='On' && modes.includes(s.Mode.modes[0]))
          ? CurrentHeaterCoolerState.COOLING
          : CurrentHeaterCoolerState.IDLE;
      }));

    this.aircoSamsung.getCharacteristic(TargetHeaterCoolerState)
      .setProps({ validValues: [TargetHeaterCoolerState.COOL] })
      .on('get', cb => this.handleGet(cb, '목표 운전 모드', () => TargetHeaterCoolerState.COOL))
      .on('set', this.setTargetHeaterCoolerState.bind(this));

    this.aircoSamsung.getCharacteristic(CurrentTemperature)
      .on('get', cb => this.handleGet(cb, '현재 온도', s => s.Temperatures[0].current));

    this.aircoSamsung.getCharacteristic(CoolingThresholdTemperature)
      .setProps({ minValue: 18, maxValue: 30, minStep: 1 })
      .on('get', cb => this.handleGet(cb, '목표 온도', s => s.Temperatures[0].desired))
      .on('set', this.setTargetTemperature.bind(this));

    this.aircoSamsung.getCharacteristic(SwingMode)
      .on('get', cb => this.handleGet(cb, '스윙/무풍 모드', s => {
        return (this.swingModeType==='wind')
          ? s.Wind.direction==="Up_And_Low"
          : s.Mode.options.includes("Comode_Nano");
      }))
      .on('set', this.setSwingMode.bind(this));

    this.aircoSamsung.getCharacteristic(LockPhysicalControls)
      .on('get', cb => this.handleGet(cb, '자동 청소', s => s.Mode.options.includes("Autoclean_On")))
      .on('set', this.setLockPhysicalControls.bind(this));

    return [ this.informationService, this.aircoSamsung ];
  }

  // --- Setters (즉시 callback → 백그라운드 전송) ---
  setActive(value, callback) {
    this.log.info(`[${this.name}] [SET] 전원 → ${value}`);
    callback(null);
    this.sendCommand('', { Operation: { power: value ? 'On' : 'Off' } })
      .catch(err => this.log.error(err));
  }

  setTargetTemperature(value, callback) {
    this.log.info(`[${this.name}] [SET] 목표 온도 → ${value}`);
    callback(null);
    this.sendCommand('/temperatures/0', { desired: value })
      .catch(err => this.log.error(err));
  }

  setSwingMode(value, callback) {
    const modeName = this.swingModeType === 'wind' ? '스윙' : '무풍';
    this.log.info(`[${this.name}] [SET] ${modeName} → ${value}`);
    callback(null);
    const cmd = (this.swingModeType === 'wind')
      ? { direction: value ? "Up_And_Low" : "Fix" }
      : { options: [ value ? "Comode_Nano" : "Comode_Off" ] };
    const ep = this.swingModeType === 'wind' ? '/wind' : '/mode';
    this.sendCommand(ep, cmd)
      .catch(err => this.log.error(err));
  }

  setLockPhysicalControls(value, callback) {
    this.log.info(`[${this.name}] [SET] 자동 청소 → ${value}`);
    callback(null);
    this.sendCommand('/mode', { options: [ value ? 'Autoclean_On' : 'Autoclean_Off' ] })
      .catch(err => this.log.error(err));
  }

  setTargetHeaterCoolerState(value, callback) {
    this.log.info(`[${this.name}] [SET] 목표 운전 모드 → ${value}`);
    callback(null);
    if (value === Characteristic.TargetHeaterCoolerState.COOL) {
      this.sendCommand('/mode', { modes: ["DryClean"] })
        .catch(err => this.log.error(err));
    }
  }
}
