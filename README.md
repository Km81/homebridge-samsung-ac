# Homebridge Samsung AC (구형 모델 / Legacy Model)

구형 삼성 에어컨(TLSv1 통신 방식)을 Apple HomeKit에 연동하기 위한 Homebridge 플러그인입니다.

이 플러그인은 최신 Node.js(v17 이상) 환경에서 발생하는 TLS 호환성 문제를 해결하기 위한 패치를 포함하고 있어, 최신 Homebridge 환경에서도 구형 에어컨을 안정적으로 사용할 수 있습니다. 또한, **인증서가 플러그인에 내장**되어 있어 사용자는 더 이상 `.pem` 파일을 직접 구하거나 경로를 설정할 필요가 없습니다.

## 주요 기능

* **구형 삼성 에어컨 지원**: TLSv1 통신 프로토콜을 사용하는 모델 지원
* **최신 Homebridge 호환**: Node.js v17, v18, v22 등 최신 버전에서 발생하는 모든 TLS/HTTP 오류 해결
* **인증서 내장**: 별도의 `.pem` 파일 없이 플러그인 설치만으로 모든 준비 완료
* **UI 설정 지원**: Homebridge UI를 통해 모든 설정을 간편하게 구성 가능
* **상태 캐싱 및 폴링**: API 요청을 최소화하고 리모컨 등으로 변경된 상태를 자동 동기화

## 사전 준비

* Homebridge 최신 버전 (UI 환경 권장)
* 에어컨의 고정 IP 주소
* 에어컨의 인증 토큰 (추출 방법은 아래 참조)

## 설치

Homebridge UI의 '플러그인' 탭에서 `homebridge-samsung-ac`을 검색하여 설치합니다.

## 토큰(Token) 추출 방법

이 플러그인을 사용하기 위해서는 에어컨의 고유 인증 토큰이 필요합니다. 토큰은 아래의 Python 스크립트를 사용하여 추출할 수 있습니다.

**준비물:**
* Python 3가 설치된 컴퓨터 (Homebridge가 설치된 NAS 또는 다른 PC)
* 컴퓨터는 에어컨과 동일한 네트워크에 연결되어 있어야 합니다.

**추출 절차:**

1.  아래의 Python 코드를 컴퓨터에 `get_token.py` 라는 이름으로 저장합니다.

    ```python
    #!/usr/bin/env python3
    import ssl
    import socket
    import os

    # --- 설정 ---
    SERVER_IP = '0.0.0.0' # 모든 IP에서 접속 허용
    SERVER_PORT = 8889
    CERT_FILE = 'cert.pem'
    KEY_FILE = 'key.pem'

    def generate_self_signed_cert(cert_file, key_file):
        """임시 SSL 인증서 생성"""
        print(f"'{cert_file}' 및 '{key_file}' 생성 중...")
        os.system(f'openssl req -new -newkey rsa:2048 -days 365 -nodes -x509 -keyout {key_file} -out {cert_file} -subj "/C=KR/ST=Seoul/L=Seoul/O=Samsung/OU=Homebridge/CN=localhost"')

    def main():
        """가짜 서버를 실행하여 토큰을 수신하고 출력"""
        if not (os.path.exists(CERT_FILE) and os.path.exists(KEY_FILE)):
            generate_self_signed_cert(CERT_FILE, KEY_FILE)

        context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        context.load_cert_chain(certfile=CERT_FILE, keyfile=KEY_FILE)
        
        print("-" * 50)
        print(f"토큰 수신을 위해 포트 {SERVER_PORT}에서 대기 중입니다...")
        print("이제 에어컨을 AP 모드로 변경하고, 모바일 앱으로 Wi-Fi 설정 시")
        print("서버 주소를 이 컴퓨터의 IP로 지정해 주세요.")
        print("성공하면 여기에 토큰이 출력됩니다.")
        print("-" * 50)

        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind((SERVER_IP, SERVER_PORT))
            sock.listen(5)
            with context.wrap_socket(sock, server_side=True) as ssock:
                conn, addr = ssock.accept()
                with conn:
                    print(f"연결 수립: {addr}")
                    while True:
                        try:
                            data = conn.recv(4096)
                            if not data:
                                break
                            
                            http_request = data.decode('utf-8', errors='ignore')
                            
                            # 'Authorization' 헤더에서 토큰 찾기
                            for line in http_request.splitlines():
                                if 'authorization' in line.lower():
                                    print("\n" + "="*20 + " 토큰 발견! " + "="*20)
                                    token = line.split(' ')[-1]
                                    print(f"추출된 토큰: {token}")
                                    print("="*50)
                                    print("이 토큰을 복사하여 Homebridge 설정에 사용하세요.")
                                    return
                        except Exception as e:
                            print(f"데이터 수신 중 오류: {e}")
                            break
    if __name__ == '__main__':
        main()
    ```

2.  터미널에서 `get_token.py` 파일을 저장한 폴더로 이동한 뒤, 아래 명령어로 가짜 서버를 실행합니다.
    ```sh
    python3 get_token.py
    ```

3.  터미널에 "토큰 수신을 위해... 대기 중입니다..." 라는 메시지가 뜨면, **에어컨을 AP 모드(또는 Wi-Fi 설정 모드)로 변경**합니다. (리모컨의 특정 버튼을 길게 누르는 등 모델별 설명서 참조)

4.  스마트폰의 **삼성 Smart Air Conditioner 앱**을 사용하여 에어컨을 네트워크에 연결하는 절차를 진행합니다. 이 과정에서 **서버 주소를 입력하라는 단계가 나오면, 2번 단계의 스크립트를 실행한 컴퓨터의 IP 주소를 입력**합니다.

5.  연결이 성공하면, 2번 단계의 터미널 화면에 **`추출된 토큰: XXXXXXXX`** 와 같이 토큰이 출력됩니다. 이 값을 복사하여 Homebridge 설정에 사용합니다.

## 설정

Homebridge UI의 플러그인 설정 화면에서 아래 항목들을 입력합니다.

| 키 | 설명 | 필수 | 기본값 |
| :--- | :--- | :--- | :--- |
| `name` | 홈 앱에 표시될 에어컨의 이름입니다. | 예 | - |
| `ip` | 에어컨의 고정 IP 주소입니다. | 예 | - |
| `token` | 위에서 추출한 인증 토큰입니다. | 예 | - |
| `deviceIndex` | API 응답에서 상태를 **읽어올** 장치의 인덱스(0부터 시작)입니다. 실외기 하나에 실내기가 여러 대일 경우 구분합니다. | 아니오 | `0` |
| `setDeviceIndex`| 명령을 **보낼** 장치의 인덱스입니다. 보통 `deviceIndex`와 같습니다. | 아니오 | `deviceIndex` 값 |
| `swingModeType` | 스윙(회전) 모드를 제어할 방식을 선택합니다. (`comfort` 또는 `wind`) | 아니오 | `comfort` |
| `pollingInterval` | 상태를 자동으로 동기화할 시간 간격(단위: 초)입니다. 0이면 비활성화됩니다. | 아니오 | 비활성화 |

#### `config.json` 직접 수정 예시

```json
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
      "token": "YOUR-AC-TOKEN-HERE",
      "deviceIndex": 1,
      "setDeviceIndex": 0
    },
    {
      "accessory": "SamsungAC",
      "name": "안방 에어컨",
      "ip": "192.168.1.100",
      "token": "YOUR-AC-TOKEN-HERE",
      "deviceIndex": 0,
      "setDeviceIndex": 1,
      "swingModeType": "wind"
    }
  ]
}
```

### ⚠️ 보안 경고

이 플러그인은 오래된 보안 프로토콜(TLSv1)을 사용하여 에어컨과 통신합니다. 신뢰할 수 있는 **로컬 네트워크 환경에서만 사용**하시는 것을 강력히 권장합니다.
