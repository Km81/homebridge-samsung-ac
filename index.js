// Samsung Air Conditioner Homebridge Plugin
// Version 1.9.15 (Definitive Edition with All Fixes and Optimizations)
'use strict';

const tls = require('tls');
const { constants } = require('crypto');

let HAP;
let Service, Characteristic;

// 인증서 내장
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
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIDRzCCAi+gAwIBAgIBADANBgkqhkiG9w0BAQUFADA8MQswCQYDVQQGEwJLUjEc
MBoGA1UECgwTU2Ftc3VuZyBFbGVjdHJvbmljczEPMA0GA1UEAwwGUk9PVENBMCIY
DzE5NjAwMTAxMDAwMDAwWhgPMjA2MDAxMDEwMDAwMDBaMDwxCzAJBgNVBAYTAktS
MRwwGgYDVQQKDBNTYW1zdW5nIEVsZWN0cm9uaWNzMQ8wDQYDVQQDDAZST09UQ0Ew
ggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCd67g2hzhbIeSBoFfeqbXi
tzbO4dCWeCigVfmwEDhR1SDA0MfHOVlFpvuFr3WyFPvQZ0ccNrsTpBs5YieI/jZi
FYWO0ktbqQorL1CIFqBL9kAF+34BYtpl98PgJ1grLOH5T3GugJA7Irw0plEFmOfs
IydlUIQHl3oqyMIWPa2nIZ/FGi3hAquEPrvzHZB+QO4c+6tV1WLIaCjn88xkYuwz
uGYxaqJpnGdqhjZRIuHb2DEZPlP1VGdTTAttno36CyWqeHrSC8fXCSu55Zk+1rbC
Py/phOJjSyce2qk0IebETAYLCLqU7ABJxUxrolMrP37OB+Kqe4RWovaeMcdcNOOt
AgMBAAGjUDBOMB0GA1UdDgQWBBTtqd2uYUWvFgzz73eWuf8WrjuxczAfBgNVHSME
GDAWgBTtqd2uYUWvFgzz73eWuf8WrjuxczAMBgNVHRMEBTADAQH/MA0GCSqGSIb3
DQEBBQUAA4IBAQBkwK95x8JCAnY0F2bMwG5+7QfY+ci8s8m1ODi3v19HECS6nG9j
SXgwihEtQ3HqvUler+n7aOeAZlgm+BymM2GvuicveYN/nevIvzlpMOn2L6xU19/H
zM2eoDVfS49+i/cwoi/A7fcZmIYggZho2UJR/GvKc79g6EAhT7/i5alBZF0enMsA
9okzakb/aohQE9SzsEHnhVKpGAjvu0/TJK9WwX6mkiIEJY+mzQMWgEeQt6WWIgAb
gSX9NueH80tpZ9KqFnqnOoLxTAa7k0RPBRwyUO9CDhSnlWIEcsD9sqR2M+niOFnT
KBHcLDDiEU3llprD8FRV3unYrl0F0B2GGdRk
-----END CERTIFICATE-----
`;

const API_PORT = 8888;
const API_DEVICES_PATH = '/devices';
const PLUGIN_VERSION = '1.9.15';

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
      if (this.pollingIntervalId) {
        clearInterval(this.pollingIntervalId);
      }
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
      const socket = tls.connect(this.tlsOptions, () => {
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
        
        const headerSection = lines.join('\r\n') + '\r\n\r\n';

        this.log.debug(`[${this.name}] 요청 전송:\n${headerSection}${body}`);
        socket.write(headerSection + body);
        socket.end();
      });

      let responseChunks = '';
      socket.setEncoding('utf8');
      socket.on('data', chunk => responseChunks += chunk);
      socket.on('end', () => {
        this.log.debug(`[${this.name}] 응답 수신:\n${responseChunks}`);
        
        const separator = '\r\n\r\n';
        const headerEndIndex = responseChunks.indexOf(separator);
        
        if (headerEndIndex === -1) {
          return reject(new Error('HTTP 응답에서 헤더와 본문의 구분을 찾을 수 없습니다.'));
        }
        
        const body = responseChunks.slice(headerEndIndex + separator.length).trim();

        if (!body || body.indexOf('{') < 0) {
          return reject(new Error(`응답에서 유효한 JSON 본문을 발견하지 못했습니다.`));
        }
        try {
          const jsonResponse = JSON.parse(body);
          resolve(jsonResponse);
        } catch (e) {
          this.log.error(`[${this.name}] 응답 JSON 파싱 실패. 원본 데이터:`, body);
          reject(new Error(`응답 데이터 JSON 파싱에 실패했습니다.`));
        }
      });
      socket.on('timeout', () => {
        socket.destroy(new Error('요청 시간 초과'));
      });
      socket.on('error', (err) => reject(new Error(`TLS 소켓 오류: ${err.message}`)));
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
      this.log.debug(`[${this.name}] 유효한 캐시 사용`);
      return this.deviceState;
    }
    
    this.log.debug(`[${this.name}] 새 상태 요청 (캐시 만료 또는 강제 새로고침)`);
    try {
      const response = await this._request('GET', API_DEVICES_PATH);
      if (!response || !response.Devices || !Array.isArray(response.Devices)) {
        throw new Error('API 응답이 비정상적이거나 Devices 배열이 없습니다.');
      }
      this.deviceState = response;
      this.lastStateUpdate = now;

      // 요청한 인덱스의 장치가 실제로 존재하는지 다시 한번 확인
      if (!this.deviceState.Devices[this.deviceIndex]) {
        throw new Error(`API 응답에서 요청한 장치(index: ${this.deviceIndex})를 찾을 수 없습니다.`);
      }
      
      return this.deviceState.Devices[this.deviceIndex];
    } catch (error) {
      this.log.error(`[${this.name}] 상태를 가져오는 데 실패했습니다:`, error.message);
      if (this.deviceState && this.deviceState.Devices[this.deviceIndex]) {
        this.log.warn(`[${this.name}] API 오류가 발생했으나, 마지막으로 성공한 캐시 데이터를 사용합니다.`);
        return this.deviceState.Devices[this.deviceIndex];
      }
      throw error;
    }
  }

  async sendCommand(endpoint, data) {
    this.log.info(`[${this.name}] [COMMAND] ${endpoint} -> ${JSON.stringify(data)}`);
    await this._request('PUT', `/devices/${this.setDeviceIndex}${endpoint}`, data);
    this.log.info(`[${this.name}] [COMMAND] 전송 완료`);

    // Optimistic Update: 로컬 캐시를 즉시 업데이트하여 UI 반응성을 높입니다.
    this.log.debug(`[${this.name}] 로컬 캐시 즉시 업데이트...`);
    if (this.deviceState && this.deviceState.Devices[this.deviceIndex]) {
      const targetDeviceState = this.deviceState.Devices[this.deviceIndex];
      if (endpoint === '' && data.Operation?.power) {
        targetDeviceState.Operation.power = data.Operation.power;
      }
      if (endpoint === '/mode' && data.modes) {
        targetDeviceState.Operation.power = 'On';
        targetDeviceState.Mode.modes = data.modes;
      }
      if (endpoint.startsWith('/temperatures/')) {
        targetDeviceState.Temperatures[0].desired = data.desired;
      }
      if (endpoint === '/mode' && data.options) {
          const optionToSet = data.options[0];
          const isEnabling = optionToSet.endsWith('_On');
          const baseOpt = isEnabling ? optionToSet.replace('_On', '') : optionToSet.replace('_Off', '');
          
          targetDeviceState.Mode.options = targetDeviceState.Mode.options.filter(o => !o.startsWith(baseOpt));
          if (isEnabling) {
              targetDeviceState.Mode.options.push(optionToSet);
          }
      }
    }

    // 백그라운드에서 실제 상태를 다시 가져와서 데이터 일관성을 맞춥니다.
    this.getCachedState(true).catch(e => {
      this.log.warn(`[${this.name}] 명령 후 상태 동기화 실패 (무시됨):`, e.message);
    });
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
      .onGet(this.getTargetHeaterCoolerState.bind(this))
      .onSet(this.setTargetHeaterCoolerState.bind(this)); 
      
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

  // --- ▼▼▼ Characteristic Handlers (최종 안정화 적용) ▼▼▼ ---
  
  async getActive() {
    this.log.debug(`[${this.name}] GET Active`);
    const currentDeviceState = this.deviceState?.Devices?.[this.deviceIndex];
    if (!currentDeviceState) throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    
    const isActive = currentDeviceState.Operation.power === 'On';
    this.log.info(`[${this.name}] > Active: ${isActive ? 'ON' : 'OFF'}`);
    return isActive;
  }

  async setActive(value) {
    try {
      if (value) {
        this.log.info(`[${this.name}] SET Active -> ON (전원 켜고 1초 후 제습 모드로 변경)`);
        await this.sendCommand('', { "Operation": { "power": "On" } });
        this.log.debug(`[${this.name}] > 모드 변경을 위해 1초 대기...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        await this.sendCommand('/mode', { "modes": ["Dry"] });
      } else {
        this.log.info(`[${this.name}] SET Active -> OFF`);
        await this.sendCommand('', { "Operation": { "power": "Off" } });
      }
    } catch (e) {
      this.log.error(`[${this.name}] SET Active 실패:`, e.message);
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getCurrentHeaterCoolerState() {
    this.log.debug(`[${this.name}] GET CurrentState`);
    const currentDeviceState = this.deviceState?.Devices?.[this.deviceIndex];
    if (!currentDeviceState) throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);

    if (currentDeviceState.Operation.power !== 'On') {
      this.log.info(`[${this.name}] > CurrentState: INACTIVE`);
      return Characteristic.CurrentHeaterCoolerState.INACTIVE;
    }
    
    const mode = currentDeviceState.Mode.modes[0];
    const isCooling = ['CoolClean', 'Cool', 'Dry', 'DryClean', 'Auto', 'Wind'].includes(mode);
    
    if (isCooling) {
      this.log.info(`[${this.name}] > CurrentState: COOLING`);
      return Characteristic.CurrentHeaterCoolerState.COOLING;
    }

    this.log.info(`[${this.name}] > CurrentState: IDLE`);
    return Characteristic.CurrentHeaterCoolerState.IDLE;
  }
  
  async getTargetHeaterCoolerState() {
    this.log.debug(`[${this.name}] GET TargetState`);
    return Characteristic.TargetHeaterCoolerState.COOL;
  }

  async setTargetHeaterCoolerState(value) {
    this.log.info(`[${this.name}] SET TargetState -> ${value} (무시됨)`);
  }
  
  async getCurrentTemperature() {
    this.log.debug(`[${this.name}] GET CurrentTemperature`);
    const currentDeviceState = this.deviceState?.Devices?.[this.deviceIndex];
    if (!currentDeviceState) throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    const temp = currentDeviceState.Temperatures[0].current;
    this.log.info(`[${this.name}] > CurrentTemperature: ${temp}°C`);
    return temp;
  }

  async getTargetTemperature() {
    this.log.debug(`[${this.name}] GET TargetTemperature`);
    const currentDeviceState = this.deviceState?.Devices?.[this.deviceIndex];
    if (!currentDeviceState) throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    const temp = currentDeviceState.Temperatures[0].desired;
    this.log.info(`[${this.name}] > TargetTemperature: ${temp}°C`);
    return temp;
  }
  
  async setTargetTemperature(value) {
    this.log.info(`[${this.name}] SET TargetTemperature -> ${value}°C`);
    try {
      await this.sendCommand('/temperatures/0', { desired: value });
    } catch (e) {
      this.log.error(`[${this.name}] SET TargetTemp 실패:`, e.message);
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }
  
  async getSwingMode() {
    this.log.debug(`[${this.name}] GET SwingMode`);
    const currentDeviceState = this.deviceState?.Devices?.[this.deviceIndex];
    if (!currentDeviceState) throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    const isEnabled = this.swingModeHandler.getValue(currentDeviceState);
    this.log.info(`[${this.name}] > SwingMode: ${isEnabled ? 'ENABLED' : 'DISABLED'}`);
    return isEnabled;
  }

  async setSwingMode(value) {
    const enabled = !!value;
    this.log.info(`[${this.name}] SET SwingMode -> ${enabled ? 'ENABLED' : 'DISABLED'}`);
    try {
      const { endpoint, data } = this.swingModeHandler.getCommand(enabled);
      await this.sendCommand(endpoint, data);
    } catch (e) {
      this.log.error(`[${this.name}] SET SwingMode 실패:`, e.message);
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getLockPhysicalControls() {
    this.log.debug(`[${this.name}] GET LockControls`);
    const currentDeviceState = this.deviceState?.Devices?.[this.deviceIndex];
    if (!currentDeviceState) throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    const isLocked = currentDeviceState.Mode.options.includes('Autoclean_On');
    this.log.info(`[${this.name}] > LockControls: ${isLocked ? 'ENABLED' : 'DISABLED'}`);
    return isLocked;
  }

  async setLockPhysicalControls(value) {
    const cmd = value ? 'Autoclean_On' : 'Autoclean_Off';
    this.log.info(`[${this.name}] SET LockControls -> ${cmd}`);
    try {
      await this.sendCommand('/mode', { options: [cmd] });
    } catch (e) {
      this.log.error(`[${this.name}] SET LockControls 실패:`, e.message);
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }
}
