Homebridge Samsung AC (구형 모델)
구형 삼성 에어컨(TLSv1 통신 방식)을 Apple HomeKit에 연동하기 위한 Homebridge 플러그인입니다.

이 플러그인은 상태 캐싱, 자동 재시도, 주기적인 상태 폴링 등 안정적인 작동을 위한 다양한 기능들을 포함하고 있습니다.

주요 기능
구형 삼성 에어컨 지원: TLSv1 통신 프로토콜을 사용하는 구형 모델 지원

상태 캐싱: API 요청을 최소화하여 에어컨에 가해지는 부하를 줄이고 빠른 응답 속도를 제공합니다.

주기적인 상태 폴링: 리모컨 등 다른 방법으로 에어컨 상태가 변경되어도, 설정된 시간마다 상태를 자동으로 동기화합니다.

안정적인 통신: 네트워크가 불안정할 경우, API 요청을 자동으로 재시도하여 통신 실패를 최소화합니다.

상세한 디버그 로그: -D 옵션으로 Homebridge를 실행하여 플러그인의 모든 동작 과정을 상세히 확인할 수 있습니다.

사전 준비
Homebridge: Homebridge가 설치되어 있어야 합니다.

Node.js: v16.x 버전을 권장합니다. (최신 버전은 TLSv1 지원이 제한될 수 있습니다.)

인증서 파일: 에어컨과 통신하기 위한 .pem 인증서 파일이 필요합니다.

설치
아래 명령어를 통해 플러그인을 설치합니다.

npm install -g homebridge-samsung-ac

(v1.8.10부터는 async-lock과 같은 추가적인 의존성 패키지를 설치할 필요가 없습니다.)

설정
Homebridge의 config.json 파일에 아래와 같이 accessories 섹션을 추가합니다.

{
  "bridge": {
    "name": "Homebridge",
    "username": "0E:2A:3B:4C:5D:6E",
    "port": 51826,
    "pin": "031-45-154"
  },
  "accessories": [
    {
      "accessory": "SamsungAC",
      "name": "거실 에어컨",
      "ip": "192.168.1.100",
      "token": "YOUR-AC-TOKEN",
      "certPath": "/path/to/your/cert.pem",
      "keyPath": "/path/to/your/key.pem",
      "deviceIndex": 0,
      "setDeviceIndex": 0,
      "swingModeType": "comfort",
      "pollingInterval": 60,
      "timeout": 7000,
      "cacheDuration": 30000
    }
  ]
}

설정 항목 설명

키

설명

필수 여부

기본값

accessory

"SamsungAC"로 고정해야 합니다.

예

-

name

홈 앱에 표시될 에어컨의 이름입니다.

예

-

ip

에어컨의 고정 IP 주소입니다.

예

-

token

에어컨과 통신하기 위한 인증 토큰입니다.

예

-

certPath

.pem 인증서 파일의 전체 경로입니다. (기존 patchCert도 호환됩니다)

예

-

keyPath

개인 키 파일의 전체 경로입니다. 인증서와 키가 같은 파일에 있다면 certPath와 동일하게 설정하거나 생략합니다.

아니오

certPath 값

deviceIndex

API 응답에서 상태를 읽어올 장치의 인덱스(0부터 시작)입니다.

아니오

0

setDeviceIndex

API 요청 시 명령을 보낼 장치의 인덱스입니다. deviceIndex와 다를 수 있습니다.

아니오

deviceIndex 값

swingModeType

스윙(회전) 모드를 제어하는 방식을 선택합니다. (comfort 또는 wind)

아니오

"comfort"

pollingInterval

상태를 자동으로 동기화할 시간 간격(단위: 초)입니다. 리모컨 사용 시 유용합니다.

아니오

비활성화

timeout

API 요청 시 응답을 기다리는 최대 시간(단위: 밀리초)입니다.

아니오

5000 (5초)

cacheDuration

한번 가져온 상태 정보를 캐시에 저장해 둘 시간(단위: 밀리초)입니다.

아니오

30000 (30초)

문제 해결
플러그인이 예상대로 동작하지 않을 경우, Homebridge를 디버그 모드로 실행하여 상세한 로그를 확인할 수 있습니다.

homebridge -D

로그를 통해 API 요청/응답, 캐시 상태, 오류 메시지 등 문제의 원인을 파악하는 데 도움을 받을 수 있습니다.

⚠️ 보안 경고
이 플러그인은 TLSv1이라는 오래된 보안 프로토콜을 사용하여 구형 에어컨과 통신합니다. TLSv1은 현대적인 보안 표준에 비해 취약점이 있으며, 이 플러그인은 rejectUnauthorized: false 옵션을 사용하여 통신합니다.

따라서 신뢰할 수 있는 로컬 네트워크 환경에서만 사용하시는 것을 강력히 권장합니다.

