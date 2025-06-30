// Samsung Air Conditioner Homebridge Plugin
// Version 1.9.19 (Definitive Edition with Correct PEM Handling)
'use strict';

const tls = require('tls');
const { constants } = require('crypto');

let HAP;
let Service, Characteristic;

// 1. Private Key 부분만 별도로 저장합니다. (들여쓰기 없음)
const privateKey = `-----BEGIN PRIVATE KEY-----
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
-----END PRIVATE KEY-----`;

// 2. Certificate 부분들과 그 중간 인증서들을 모두 합쳐서 저장합니다. (들여쓰기 없음)
const certificateChain = `-----BEGIN CERTIFICATE-----
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
BBgwFoAU/12TkC/BOF7xDaZZWJ+DGN6nMxcwDAYDVR0TBAUwAwEB/zAhBgNVHREE
GjAYggtzYW1zdW5nLmNvbYIJbG9jYWxob3N0MA0GCSqGSIb3DQEBBQUAA4IBAQBW
0mStlbdvrHqDJ+KOKVf0C/y9FKTODqo/6/wJNZeZ+8ezPza4nFq70MwQYTpSbZhz
5w8bQP9fwSAoa2Vki8ZwcSd85Vi2tHz9O4C7d7zBA3FU8AL3NoEMFv6OGWGPnTY5
mG/Hn+LxuwQddlysfbRDds1LBY8DBUJNAmIeeWqA5Eg8DW6xJUwHeXUElJpSXHW6
XGvpWgAhXqoIf6TirdCrPY6+IzV/FcuVtBDGi+JoxgrMfMLgLEVjeSY96DJinHgZ
RT0FkA5e06Z+fqHh9Btu+aed+kuGSmya/A5wStOkGeKEbezbbN2gtW07lN6VxX3J
OCgygA+hmnBVnRDA8Jzu
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIDUTCCAjmgAwIBAgIBADANBgkqhkiG9w0BAQUFADA6MQswCQYDVQQGEwJLUjEc
MBoGA1UECgwTU2Ftc3VuZyBFbGVjdHJvbmljczENMAsGA1UEAwwEQ0VDQTAiGA8x
OTYwMDEwMTAwMDAwMFoYDzIwNjAwMTAxMDAwMDAwWjBIMQswCQYDVQQGEwJLUjEc
MBoGA1UECgwTU2Ftc3VuZyBFbGVjdHJvbmljczEbMBkGA1UEAwwSUmVtb3RlQWNj
ZXNzQ0EoQ0UpMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtatz9GvV
qbV395Whnad9MC9TEOiXuwnw37QHvQUwOTFgc6AenX5SORfb4UTw+0ApFNba9DlY
Xx/K9E5b5DGasDVGGTn+z+6MPB7GuAjkP+WSRwHMjrHRNqrBOr1YJUw3SIbMkRoT
460k9AD9DQDBORRtGBGwcBw6BvdasA+/L3Q63aJ7pDoj3qxocdcgk/zFq0OrxFDL
PMTL7a+a9DS8G10K73XGgES0RBwwhlXXVuLUprD6RgbeLHFsPpIq5vzzEpAYMCF6
vkZKjDGEW7JVTgUu0E37niN3NQv1gIXlJusDH6RWfFQxENZsdFkT/l+kTuY283Ga
2Ei1HsW3Xpt88QIDAQABo1AwTjAdBgNVHQ4EFgQU/12TkC/BOF7xDaZZWJ+DGN6n
MxcwHwYDVR0jBBgwFoAURwF9jkihypJa2u6zRwKrZwRlACswDAYDVR0TBAUwAwEB
/zANBgkqhkiG9w0BAQUFAAOCAQEAZkjxN4O92e1RTaXx1mpazyT98sJVl46R51s1
CTPq35HVfTiBOAu0C5MR6a9vIIFJScy5h69VN4OwDDbMhe/k3m6EfAutlL7lRrre
OT853HJahxdavzaXJ7tcrI/yDJI0X5GbQ8W74mmDt2/5rXsaB+h+NrToGqf6Hvf/
m7ZhUnCAt0hhLmltxTVYS25s9KoiIH0rXOb9cqUFsmBMEG2pHWC5AiSc0cXJm+kU
3z0B2GS+4IjGdVr3FTPzzTXrpqq/X1cIVKAum5WfsFMS0CRvqTVNVwYg52n69T2B
NPCCEpp9rsIieZ58jsnc506Uc+1Vp+NmBI2A/ecypZxSb6v9gg==
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIDRTCCAi2gAwIBAgIBBDANBgkqhkiG9w0BAQUFADA8MQswCQYDVQQGEwJLUjEc
MBoGA1UECgwTU2Ftc3VuZyBFbGVjdHJvbmljczEPMA0GA1UEAwwGUk9PVENBMCIY
DzE5NjAwMTAxMDAwMDAwWhgPMjA2MDAxMDEwMDAwMDBaMDoxCzAJBgNVBAYTAktS
MRwwGgYDVQQKDBNTYW1zdW5nIEVsZWN0cm9uaWNzMQ0wCwYDVQQDDARDRUNBMIIB
IjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtv1WJJ7tTs/aa1ZZRjMPPLeb
n/Ev0Y28CSBj/6P031/veZSg/2z65QZUvPjv8MZnIgNoMpxMGbPPO4Dxj+QJthBk
WydWRPguPyE+w3U4SdayZXWpLZTpKfHco3CklFwEqZtG/wTxHD1oOvtT0e2g5c79
hNQt9lQ4Wwzqa3MvQd0JyeB4syy2zRLo5NjJZl1BVn2oTt4xGCjjtAXtAqqHEbEf
pcvB3hPdIpFe6M8zuN22kROKaQ5i4XP4CyEpbFlgKRcWBGQFX3I5f5TdD3Yw1Ril
OLLL9wFsJ+iWLka9tAIcJKCNOf48p7aXm6COFwmjtCNu4wjQozwi6cycKUgxNQID
AQABo1AwTjAdBgNVHQ4EFgQURwF9jkihypJa2u6zRwKrZwRlACswHwYDVR0jBBgw
FoAU7andrmFFrxYM8+93lrn/Fq47sXMwDAYDVR0TBAUwAwEB/zANBgkqhkiG9w0B
AQUFAAOCAQEATexseQBXSfUR7fFTFxq6aAvHWIN+h3QLeN1sq8KCM4fbdkH3lOUP
rKW3w1ag62bnJVNjT4xPtzH/DyrqlzQUPTb7S0PfIXt2mu/VURnrmuXidS2grNwv
eu10gURZaz9N2UZEhY7E80tUZwcjAV+YP8+x3/iRQSrWvcMma/r01eUnwrF4xaE9
EYtJ/jTRre8MpEH/lg06m+rZf9Lk/yhG6at0YnUAIytThqFV4Cj8T8jBX+KG8BCo
VyUsFyrO+D6X98gMdTZnLqC1P1iWuxyrOWZTgsf44f5GXzmLqe5KLPvkDb4MywTa
nXrSOPSkcIgvS6WYw2Rii+e6lfVzqmhAmg==
-----END CERTIFICATE-----`;

const API_PORT = 8888;
const API_DEVICES_PATH = '/devices';
const PLUGIN_VERSION = '1.9.19';

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
      key: privateKey,
      cert: certificateChain,
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
      .setCharacteristic(Characteristic.SerialNumber, config.serialNumber || 'B5VNP3EH701769Y')
      .setCharacteristic(Characteristic.FirmwareRevision, PLUGIN_VERSION);

    this.log.info(`[${this.name}] Samsung AC Plugin v${PLUGIN_VERSION} 초기화 시작...`);
    
    this.getCachedState(true).catch(e => {
      this.log.error(`[${this.name}] 초기 상태 로딩에 실패했습니다:`, e.message);
    }).finally(() => {
      this.startPolling();
      this.log.info(`[${this.name}] 초기화 완료.`);
    });

    this.api.on('shutdown', () => {
      this.log.info(`[${this.name}] Homebridge가 종료됩니다. 폴링 타이머를 정리합니다.`);
      if (this.pollingIntervalId) clearInterval(this.pollingIntervalId);
    });
  }

  startPolling() {
    if (this.pollingInterval > 0) {
      this.log.info(`[${this.name}] ${this.pollingInterval}초 간격으로 상태 폴링을 시작합니다.`);
      this.pollingIntervalId = setInterval(() => {
        this.log.debug(`[${this.name}] 주기적인 상태 업데이트 실행...`);
        this.getCachedState(true).catch(e => this.log.warn(`[${this.name}] 폴링 실패:`, e.message));
      }, this.pollingInterval * 1000);
    }
  }

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
          'Connection: close',
        ];
        if (body) {
          lines.push('Content-Type: application/json');
          lines.push(`Content-Length: ${Buffer.byteLength(body)}`);
        }
        socket.write(lines.join('\r\n') + '\r\n\r\n' + body);
        socket.end();
      });

      let response = '';
      socket.setEncoding('utf8');
      socket.on('data', chunk => response += chunk);
      socket.on('end', () => {
        const sep = '\r\n\r\n';
        const idx = response.indexOf(sep);
        let headers = '', body = response;
        if (idx !== -1) {
          headers = response.slice(0, idx);
          body = response.slice(idx + sep.length).trim();
        }
        if (!body) return reject(new Error('빈 응답을 받았습니다.'));
        if (/Transfer-Encoding:\s*chunked/i.test(headers)) {
          body = body.split('\r\n').filter((_, i) => i % 2 === 1).join('');
        }
        if (!body.includes('{')) return reject(new Error('JSON 본문이 없습니다.'));
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('JSON 파싱 실패'));
        }
      });
    });
  }

  async _request(method, path, data=null, retries=3) {
    for (let i=1; i<=retries; i++) {
      try { return await this._rawRequest(path, method, data); }
      catch (e) {
        if (i===retries) {
          this.log.error(`[${this.name}] 최종 요청 실패 (${i}회): ${e.message}`);
          throw e;
        }
        this.log.warn(`[${this.name}] 요청 실패, 재시도 ${i}/${retries}: ${e.message}`);
        await new Promise(r => setTimeout(r, 1000*i));
      }
    }
  }

  async getCachedState(force=false) {
    const now = Date.now();
    if (!force && this.deviceState && (now - this.lastStateUpdate < this.cacheDuration)) {
      this.log.debug(`[${this.name}] 캐시 사용`);
      return this.deviceState;
    }
    this.log.debug(`[${this.name}] 새 상태 요청`);
    try {
      const res = await this._request('GET', API_DEVICES_PATH);
      if (!res?.Devices?.length) throw new Error('Devices 배열 없음');
      this.deviceState = res;
      this.lastStateUpdate = now;
      return res;
    } catch (e) {
      this.log.error(`[${this.name}] 상태 로딩 실패:`, e.message);
      if (this.deviceState) {
        this.log.warn(`[${this.name}] 캐시 반환`);
        return this.deviceState;
      }
      throw e;
    }
  }

  async sendCommand(endpoint, data) {
    this.log.info(`[${this.name}] [COMMAND] ${endpoint} -> ${JSON.stringify(data)}`);
    await this._request('PUT', `/devices/${this.setDeviceIndex}${endpoint}`, data);
    this.log.debug(`[${this.name}] 명령 전송 완료`);
    // 로컬 캐시 업데이트
    const ds = this.deviceState?.Devices?.[this.setDeviceIndex];
    if (ds) {
      if (endpoint==='') ds.Operation.power = data.Operation.power;
      if (endpoint.startsWith('/temperatures/')) ds.Temperatures[0].desired = data.desired;
      if (endpoint==='/mode' && data.options) {
        const opt = data.options[0], on = opt.endsWith('_On');
        const base = on ? opt.replace('_On','') : opt.replace('_Off','');
        ds.Mode.options = ds.Mode.options.filter(o=>!o.startsWith(base));
        if (on) ds.Mode.options.push(opt);
      }
    }
    this.getCachedState(true).catch(()=>{});
  }

  identify(cb) { this.log.info(`[${this.name}] Identify`); cb(); }

  getServices() {
    this.aircoSamsung.setPrimaryService(true);
    this.aircoSamsung.getCharacteristic(Characteristic.Active)
      .onGet(this.getActive.bind(this)).onSet(this.setActive.bind(this));
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
      .onGet(this.getSwingMode.bind(this)).onSet(this.setSwingMode.bind(this));
    this.aircoSamsung.getCharacteristic(Characteristic.LockPhysicalControls)
      .onGet(this.getLockPhysicalControls.bind(this))
      .onSet(this.setLockPhysicalControls.bind(this));
    return [this.informationService, this.aircoSamsung];
  }

  // --- Characteristic Handlers ---
  async getActive() {
    const st = this.deviceState?.Devices?.[this.deviceIndex];
    if (!st) throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    return st.Operation.power==='On';
  }
  async setActive(v) {
    try { await this.sendCommand('', { Operation:{ power: v?'On':'Off' } }); }
    catch { throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE); }
  }

  async getCurrentHeaterCoolerState() {
    const st = this.deviceState?.Devices?.[this.deviceIndex];
    if (!st) throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    if (st.Operation.power!=='On') return Characteristic.CurrentHeaterCoolerState.INACTIVE;
    const mode = st.Mode.modes[0];
    const cooling = ['CoolClean','Cool','Dry','DryClean','Auto','Wind'].includes(mode);
    return cooling
      ? Characteristic.CurrentHeaterCoolerState.COOLING
      : Characteristic.CurrentHeaterCoolerState.IDLE;
  }

  async getTargetHeaterCoolerState() {
    return Characteristic.TargetHeaterCoolerState.COOL;
  }
  async setTargetHeaterCoolerState() {}

  async getCurrentTemperature() {
    const st = this.deviceState?.Devices?.[this.deviceIndex];
    if (!st) throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    return st.Temperatures[0].current;
  }

  async getTargetTemperature() {
    const st = this.deviceState?.Devices?.[this.deviceIndex];
    if (!st) throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    return st.Temperatures[0].desired;
  }
  async setTargetTemperature(v) {
    try { await this.sendCommand('/temperatures/0',{desired:v}); }
    catch { throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE); }
  }

  async getSwingMode() {
    const st = this.deviceState?.Devices?.[this.deviceIndex];
    if (!st) throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    return this.swingModeHandler.getValue(st);
  }
  async setSwingMode(v) {
    const {endpoint,data} = this.swingModeHandler.getCommand(!!v);
    try { await this.sendCommand(endpoint,data); }
    catch { throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE); }
  }

  async getLockPhysicalControls() {
    const st = this.deviceState?.Devices?.[this.deviceIndex];
    if (!st) throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    return st.Mode.options.includes('Autoclean_On');
  }
  async setLockPhysicalControls(v) {
    const cmd = v ? 'Autoclean_On' : 'Autoclean_Off';
    try { await this.sendCommand('/mode',{options:[cmd]}); }
    catch { throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE); }
  }
}
