// index.js
// Samsung Air Conditioner Homebridge Plugin
// Version 1.9.22 (1.9.8 스타일 로깅 + 명령 전송 오류 수정)
'use strict';

const tls       = require('tls');
const { constants } = require('crypto');

let HAP, Service, Characteristic;

// 인증서(Private Key + 전체 체인) 내장
const defaultCertificate = `
-----BEGIN PRIVATE KEY-----
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
-----BEGIN CERTIFICATE-----
MIIDmzCCAoOgAwIBAgIBCTANBgkqhkiG9w0BAQUFADBIMQswCQYDVQQGEwJLUjEc
MBoGA1UECgwTU2Ftc3VuZyBFbGVjdHJvbmljczEbMBkGA1UEAwwSUmVtb3RlQWNj
ZXNzQ0EoQ0UpMCIYDzE5NjAwMTAxMDAwMDAwWhgPMjA2MDAxMDEwMDAwMDBaMGEx
CzAJBgNVBAYTAktSMRwwGgYDVQQKExNTYW1zdW5nIEVsZWN0cm9uaWNzMRAwDgYD
VQQDFAdBQzE0S19NMSIwIAYJKoZIhvcNAQkBFhNBQzE0S19NQHNhbXN1bmcuY29t
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3l74XLKkRVn0LUK9kxlv
njyc6ykFTTmZghhV6wZjimtoHGb16g3u9bqZApm18Q2W7KlNZxaMelrSss2viRNR
GliI1RVfw9IZ5xfggOevOdaxYwMe2GFbXfU8CWFdZUnyWkAVP3nFMrNEl5SmSbYy
KCfz8i0RBO/U4zqk8VzF5w6YgLd6IsAKWTMHiec9kFYqrUXqZCN9xg4GHC82piHp
4EhulmZBFK9q6GNIpeGlV39yEVUV/uXCdi+eOtpBTypv1J6160rKy8GxfZbUpTQP
BYKRzd3fWcqgdzAeOqBmMsWGFO2vv0d0QMdI6DX1TxXvK4kF0HKDRIGpW3PH+zeB
zwIDAQABo3MwcTAdBgNVHQ4EFgQUXzEjosLzA6xbR1KAqnmAp3BNM6MwHwYDVR0j
BBgwFoAU/12TkC/BOF7xDaZZWJ+DGN6nMxcwDAYDVR0TBAUwAwEB/zANBgkqhkiG9w0B
AQUFAAOCAQEAZkjxN4O92e1RTaXx1mpazyT98sJVl46R51s1CTPq35HVfTiBOAu0C5
MR6a9vIIFJScy5h69VN4OwDDbMhe/k3m6EfAutlL7lRrreOT853HJahxdavzaXJ7tc
rI/yDJI0X5GbQ8W74mmDt2/5rXsaB+h+NrToGqf6Hvf/m7ZhUnCAt0hhLmltxTVYS2
5s9KoiIH0rXOb9cqUFsmBMEG2pHWC5AiSc0cXJm+kU3z0B2GS+4IjGdVr3FTPzzTXrp
qq/X1cIVKAum5WfsFMS0CRvqTVNVwYg52n69T2BNPCCEpp9rsIieZ58jsnc506Uc+1
Vp+NmBI2A/ecypZxSb6v9gg==
-----END CERTIFICATE-----`;

const API_PORT         = 8888;
const API_DEVICES_PATH = '/devices';
const PLUGIN_VERSION   = '1.9.22';

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
    const opt = enable ? 'Comode_Nano' : 'Comode_Off';
    return { endpoint: '/mode', data: { options: [opt] } };
  }
}

module.exports = function(homebridge) {
  HAP           = homebridge.hap;
  Service       = HAP.Service;
  Characteristic= HAP.Characteristic;
  homebridge.registerAccessory('homebridge-samsung-ac','SamsungAC',SamsungAirco);
};

class SamsungAirco {
  constructor(log, config, api) {
    this.log              = log;
    this.config           = config;
    this.api              = api;
    this.name             = config.name;
    this.ip               = config.ip;
    this.token            = config.token;
    this.deviceIndex      = config.deviceIndex || 0;
    this.setDeviceIndex   = config.setDeviceIndex ?? this.deviceIndex;
    this.swingModeHandler = new SwingModeHandler(config.swingModeType || 'comfort');
    this.cacheDuration    = config.cacheDuration || 30000;
    this.timeout          = config.timeout || 5000;
    this.pollingInterval  = config.pollingInterval;
    this._cache           = null;
    this._cacheAt         = 0;

    if (!this.ip || !this.token) {
      throw new Error(`[${this.name}] 필수 설정(ip, token)이 누락되었습니다.`);
    }

    this.tlsOptions = {
      host:               this.ip,
      port:               API_PORT,
      key:                defaultCertificate,
      cert:               defaultCertificate,
      rejectUnauthorized: false,
      honorCipherOrder:   true,
      ciphers:            'DEFAULT@SECLEVEL=0',
      minVersion:         'TLSv1',
      maxVersion:         'TLSv1',
      secureOptions:      constants.SSL_OP_LEGACY_SERVER_CONNECT,
    };

    // 서비스 세팅
    this.acService   = new Service.HeaterCooler(this.name);
    this.infoService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'Samsung')
      .setCharacteristic(Characteristic.Model,        'AF16K7970WFN')
      .setCharacteristic(Characteristic.SerialNumber, config.serialNumber || 'UNKNOWN')
      .setCharacteristic(Characteristic.FirmwareRevision, PLUGIN_VERSION);

    // characteristic 바인딩 (1.9.8처럼 모두 로그 출력)
    this.acService.getCharacteristic(Characteristic.Active)
      .onGet(this.getActive.bind(this))
      .onSet(this.setActive.bind(this));

    this.acService.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
      .onGet(this.getCurrentHeaterCoolerState.bind(this));

    this.acService.getCharacteristic(Characteristic.TargetHeaterCoolerState)
      .setProps({ validValues: [Characteristic.TargetHeaterCoolerState.COOL] })
      .onGet(this.getTargetHeaterCoolerState.bind(this))
      .onSet(this.setTargetHeaterCoolerState.bind(this));

    this.acService.getCharacteristic(Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this));

    this.acService.getCharacteristic(Characteristic.CoolingThresholdTemperature)
      .setProps({ minValue:18,maxValue:30,minStep:1 })
      .onGet(this.getTargetTemperature.bind(this))
      .onSet(this.setTargetTemperature.bind(this));

    this.acService.getCharacteristic(Characteristic.SwingMode)
      .onGet(this.getSwingMode.bind(this))
      .onSet(this.setSwingMode.bind(this));

    this.acService.getCharacteristic(Characteristic.LockPhysicalControls)
      .onGet(this.getLockPhysicalControls.bind(this))
      .onSet(this.setLockPhysicalControls.bind(this));

    // 초기 상태 로드 + 폴링
    this.getCachedState(true)
      .catch(e=>this.log.error(`[${this.name}] 초기 상태 로딩 실패:`,e.message))
      .finally(()=>{
        if (this.pollingInterval>0) {
          this.log.info(`[${this.name}] ${this.pollingInterval}s 간격 폴링 시작`);
          this._poll = setInterval(()=>{
            this.log.debug(`[${this.name}] 주기적 상태 요청`);
            this.getCachedState(true).catch(e=>this.log.warn(`[${this.name}] 폴링 오류:`,e.message));
          }, this.pollingInterval*1000);
          this.api.on('shutdown',()=>clearInterval(this._poll));
        }
      });

    this.log.info(`[${this.name}] Samsung AC Plugin v${PLUGIN_VERSION} 초기화 완료`);
  }

  // ────────────────────────────────────────────────────────────────────
  _rawRequest(path, method, data) {
    return new Promise((resolve,reject)=>{
      const socket = tls.connect(this.tlsOptions)
        .on('error', err=>reject(new Error(`TLS 오류: ${err.message}`)));
      socket.setTimeout(this.timeout, ()=> socket.destroy(new Error('요청 시간 초과')));
      socket.on('secureConnect', ()=>{
        const body = data? JSON.stringify(data) : '';
        const headers = [
          `${method} ${path} HTTP/1.1`,
          `Host: ${this.ip}`,
          `Authorization: Bearer ${this.token}`,
          data? 'Content-Type: application/json':'',
          data? `Content-Length: ${Buffer.byteLength(body)}`:'',
          'Connection: close',
        ].filter(l=>l).join('\r\n')+'\r\n\r\n';
        this.log.debug(`[${this.name}] 요청 →\n${headers}${body}`);
        socket.write(headers+body);
      });

      let resp = '';
      socket.setEncoding('utf8');
      socket.on('data', chunk=>resp+=chunk);
      socket.on('end', ()=>{
        this.log.debug(`[${this.name}] 응답 원본:\n${resp}`);
        const sep = '\r\n\r\n', idx = resp.indexOf(sep);
        const hdr = idx>-1? resp.slice(0,idx): '';
        let body = idx>-1? resp.slice(idx+sep.length): resp;
        body = body.trim();
        if (!body) return reject(new Error('빈 응답을 받았습니다.'));
        if (/Transfer-Encoding:\s*chunked/i.test(hdr)) {
          this.log.debug(`[${this.name}] 청크 인코딩 감지, 디코딩`);
          body = body.split('\r\n').filter((_,i)=>i%2===1).join('');
        }
        if (!body.includes('{')) return reject(new Error('유효한 JSON 본문이 없습니다.'));
        try {
          const j = JSON.parse(body);
          return resolve(j);
        } catch(e) {
          this.log.error(`[${this.name}] JSON 파싱 실패:\n${body}`);
          return reject(new Error('JSON 파싱 오류'));
        }
      });
    });
  }

  async _request(method,path,data=null,retries=3) {
    for(let i=1;i<=retries;i++){
      try { return await this._rawRequest(path,method,data); }
      catch(e){
        if (i===retries) {
          this.log.error(`[${this.name}] 최종 요청 실패 (${i}/${retries}): ${e.message}`);
          throw e;
        }
        this.log.warn(`[${this.name}] 요청 오류 (${i}/${retries}): ${e.message}, 재시도...`);
        await new Promise(r=>setTimeout(r,1000*i));
      }
    }
  }

  async getCachedState(force=false) {
    const now = Date.now();
    if (!force && this._cache && (now - this._cacheAt < this.cacheDuration)) {
      this.log.debug(`[${this.name}] 캐시 사용`);
      return this._cache;
    }
    this.log.debug(`[${this.name}] 상태 새로 요청`);
    const res = await this._request('GET', API_DEVICES_PATH);
    if (!res?.Devices?.[this.deviceIndex]) {
      throw new Error('장치를 찾을 수 없습니다.');
    }
    this._cache   = res;
    this._cacheAt = now;
    return res;
  }

  async sendCommand(endpoint,data) {
    this.log.info(`[${this.name}] [COMMAND] ${endpoint} → ${JSON.stringify(data)}`);
    await this._request('PUT', `/devices/${this.setDeviceIndex}${endpoint}`, data);
    this.log.info(`[${this.name}] [COMMAND] 완료: ${endpoint}`);
    this._cache = null;
    await this.getCachedState(true);
  }

  identify(cb) { this.log.info(`[${this.name}] Identify 호출`); cb(); }
  getServices() { return [this.infoService, this.acService]; }

  // ────────────────────────────────────────────────────────────────────
  async getActive() {
    this.log.debug(`[${this.name}] GET Active`);
    const dev = (await this.getCachedState()).Devices[this.deviceIndex];
    const on = dev.Operation.power === 'On';
    this.log.info(`[${this.name}] > Active: ${on?'ON':'OFF'}`);
    return on;
  }
  async setActive(v) {
    this.log.debug(`[${this.name}] SET Active → ${v?'On':'Off'}`);
    await this.sendCommand('', { Operation: { power: v?'On':'Off' } });
  }

  async getCurrentHeaterCoolerState() {
    this.log.debug(`[${this.name}] GET CurrentState`);
    const dev = (await this.getCachedState()).Devices[this.deviceIndex];
    if (dev.Operation.power!=='On') {
      this.log.info(`[${this.name}] > CurrentState: INACTIVE`);
      return Characteristic.CurrentHeaterCoolerState.INACTIVE;
    }
    const mode = dev.Mode.modes[0]||'';
    const cooling = ['CoolClean','Cool','Dry','DryClean','Auto','Wind'].includes(mode);
    const st = cooling
      ? Characteristic.CurrentHeaterCoolerState.COOLING
      : Characteristic.CurrentHeaterCoolerState.IDLE;
    this.log.info(`[${this.name}] > CurrentState: ${cooling?'COOLING':'IDLE'}`);
    return st;
  }

  async getTargetHeaterCoolerState() {
    this.log.debug(`[${this.name}] GET TargetState → COOL`);
    return Characteristic.TargetHeaterCoolerState.COOL;
  }
  async setTargetHeaterCoolerState() {
    this.log.debug(`[${this.name}] SET TargetState 무시`);
  }

  async getCurrentTemperature() {
    this.log.debug(`[${this.name}] GET CurrentTemperature`);
    const dev = (await this.getCachedState()).Devices[this.deviceIndex];
    const t = dev.Temperatures[0].current;
    this.log.info(`[${this.name}] > CurrentTemperature: ${t}°C`);
    return t;
  }

  async getTargetTemperature() {
    this.log.debug(`[${this.name}] GET TargetTemperature`);
    const dev = (await this.getCachedState()).Devices[this.deviceIndex];
    const t = dev.Temperatures[0].desired;
    this.log.info(`[${this.name}] > TargetTemperature: ${t}°C`);
    return t;
  }
  async setTargetTemperature(v) {
    this.log.debug(`[${this.name}] SET TargetTemperature → ${v}°C`);
    await this.sendCommand('/temperatures/0', { desired: v });
  }

  async getSwingMode() {
    this.log.debug(`[${this.name}] GET SwingMode`);
    const dev = (await this.getCachedState()).Devices[this.deviceIndex];
    const on = this.swingModeHandler.getValue(dev);
    this.log.info(`[${this.name}] > SwingMode: ${on?'ENABLED':'DISABLED'}`);
    return on;
  }
  async setSwingMode(v) {
    this.log.debug(`[${this.name}] SET SwingMode → ${v?'ENABLED':'DISABLED'}`);
    const { endpoint, data } = this.swingModeHandler.getCommand(!!v);
    await this.sendCommand(endpoint, data);
  }

  async getLockPhysicalControls() {
    this.log.debug(`[this.name}] GET LockPhysicalControls`);
    const dev = (await this.getCachedState()).Devices[this.deviceIndex];
    const on = dev.Mode.options.includes('Autoclean_On');
    this.log.info(`[${this.name}] > LockPhysicalControls: ${on?'ENABLED':'DISABLED'}`);
    return on;
  }
  async setLockPhysicalControls(v) {
    this.log.debug(`[${this.name}] SET LockPhysicalControls → ${v?'On':'Off'}`);
    const cmd = v ? 'Autoclean_On' : 'Autoclean_Off';
    await this.sendCommand('/mode',{ options:[cmd] });
  }
}
