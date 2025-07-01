# Homebridge Samsung AC (구형 모델 / Legacy Model)

구형 삼성 에어컨(TLSv1 통신 방식)을 Apple HomeKit에 연동하기 위한 Homebridge 플러그인입니다.

이 플러그인은 최신 Node.js(v17 이상) 환경에서 발생하는 TLS 호환성 문제를 해결하기 위한 패치를 포함하고 있습니다. 또한, **인증서가 플러그인에 내장**되어 있어 사용자는 더 이상 `.pem` 파일을 직접 구하거나 경로를 설정할 필요 없이, 오직 **IP 주소와 토큰만으로** 플러그인을 설정할 수 있습니다.

## 주요 기능

* **구형 삼성 에어컨 지원**: TLSv1 통신 프로토콜을 사용하는 모델 지원
* **최신 Homebridge 호환**: Node.js v17, v18, v22 등 최신 버전에서 발생하는 모든 TLS/HTTP 오류 해결
* **인증서 내장**: 별도의 `.pem` 파일 설정이 필요 없어 설정이 매우 간편함
* **UI 설정 지원**: Homebridge UI를 통해 모든 설정을 간편하게 구성 가능
* **안정적인 통신**: 상태 캐싱, 자동 재시도, 주기적인 상태 폴링 기능 포함

## 사전 준비

* Homebridge 최신 버전 (UI 환경 권장)
* 에어컨의 고정 IP 주소
* Python 3 (토큰 추출 과정에서만 필요)
* **공유기 관리자 페이지 접근 권한** (DNS 설정 변경을 위해 필요)

## 설치

Homebridge UI의 '플러그인' 탭에서 `homebridge-samsung-ac`을 검색하여 설치합니다.

---

## **에어컨 토큰(Token) 추출 방법 (필수 절차)**

이 플러그인을 사용하려면 에어컨의 고유 인증 토큰이 필요합니다. 토큰은 **DNS 스푸핑(Spoofing)**이라는 기법을 사용하여, 에어컨이 삼성 클라우드 서버와 통신하는 내용을 중간에서 가로채어 추출합니다.

### **1단계: 가짜 서버 스크립트 준비**

1.  아래의 Python 코드를 복사하여 컴퓨터(또는 NAS)에 `fake_server.py` 라는 이름으로 저장합니다. 이 스크립트는 에어컨의 통신을 받아낼 가짜 서버 역할을 합니다.

    ```python
    #!/usr/bin/env python3
    import ssl
    import socket
    import os
    import threading

    # 설정
    LISTEN_IP = '0.0.0.0'
    HTTPS_PORT = 443
    CERT_FILE = 'temp_server_cert.pem'
    KEY_FILE = 'temp_server_key.pem'

    def generate_self_signed_cert(cert_file, key_file):
        """임시 SSL 서버 인증서 생성"""
        if not (os.path.exists(cert_file) and os.path.exists(key_file)):
            print(f"임시 서버 인증서 '{cert_file}' 및 '{key_file}' 생성 중...")
            subj = "/CN=api.smartthings.com"
            os.system(f'openssl req -new -newkey rsa:2048 -days 365 -nodes -x509 -keyout {key_file} -out {cert_file} -subj "{subj}"')
        print("임시 서버 인증서 준비 완료.")

    def handle_client(conn, addr):
        """클라이언트 연결 처리 및 데이터 출력"""
        print(f"\n>>> [연결 수립] From: {addr}")
        try:
            while True:
                data = conn.recv(8192)
                if not data:
                    break
                
                decoded_data = data.decode('utf-8', errors='ignore')
                print("\n" + "="*20 + " 데이터 수신 " + "="*20)
                print(decoded_data)
                
                # 'Authorization' 헤더에서 토큰 찾기
                for line in decoded_data.splitlines():
                    if 'authorization' in line.lower():
                        print("\n" + "*"*20 + " 토큰 발견! " + "*"*20)
                        token = line.split(' ')[-1]
                        print(f"추출된 토큰: {token}")
                        print("*"*54)
                        print("이 토큰을 복사하여 Homebridge 설정에 사용하세요.")
                        
                # 에어컨에 정상적인 HTTP 응답을 보내줘야 연결 절차가 완료됨
                conn.sendall(b'HTTP/1.1 200 OK\r\n\r\n')

        except Exception as e:
            print(f"[오류] 클라이언트 처리 중 오류: {e}")
        finally:
            print(f"<<< [연결 종료] From: {addr}")
            conn.close()

    def main():
        """가짜 서버를 실행하여 토큰을 수신하고 출력"""
        generate_self_signed_cert(CERT_FILE, KEY_FILE)
        context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        context.load_cert_chain(certfile=CERT_FILE, keyfile=KEY_FILE)
        
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind((LISTEN_IP, HTTPS_PORT))
            sock.listen(5)
            
            print("\n" + "="*50)
            print(f"가짜 삼성 클라우드 서버가 시작되었습니다. (포트: {HTTPS_PORT})")
            print("이제 에어컨을 Wi-Fi 설정 모드로 변경하고, SmartThings 앱으로 연결을 시도하세요.")
            print("="*50)

            while True:
                conn, addr = sock.accept()
                # 각 연결을 별도의 스레드에서 처리
                threading.Thread(target=handle_client, args=(conn, addr)).start()

    if __name__ == '__main__':
        try:
            main()
        except KeyboardInterrupt:
            print("\n서버를 종료합니다.")
        finally:
            if os.path.exists(CERT_FILE): os.remove(CERT_FILE)
            if os.path.exists(KEY_FILE): os.remove(KEY_FILE)

    ```

2.  PuTTY 등으로 NAS에 접속하여 Homebridge의 영속적인 폴더(예: `/docker/homebridge-oznu`)에 위에서 만든 `fake_server.py` 파일을 업로드합니다.

### **2단계: DNS 스푸핑 설정 (공유기 설정)**

1.  **스크립트 실행 컴퓨터의 IP 주소 확인:** `fake_server.py`를 실행할 컴퓨터(NAS)의 내부 IP 주소를 확인합니다. (예: `192.168.1.10`)
2.  **공유기 관리자 페이지 접속:** 웹 브라우저에서 공유기 관리자 페이지(보통 `192.168.0.1` 또는 `192.168.1.1`)에 접속합니다.
3.  **DNS 설정 메뉴 찾기:** '고급 설정'의 'LAN 설정' 또는 'DNS' 관련 메뉴에서 **'정적 DNS(Static DNS)', 'DNS 호스트 이름(Hostname)'** 과 같은 기능을 찾습니다.
4.  아래 내용을 입력하고 저장합니다.
    * **호스트 이름 / 도메인 이름:** `api.smartthings.com`
    * **IP 주소:** 위에서 확인한 **스크립트 실행 컴퓨터의 IP 주소** (예: `192.168.1.10`)

### **3단계: 토큰 추출 실행**

1.  **가짜 서버 실행:** PuTTY 터미널에서 `fake_server.py` 파일이 있는 폴더로 이동 후, **root 권한**으로 스크립트를 실행합니다. (443번 포트 사용을 위해 root 권한 필요)
    ```bash
    sudo python3 fake_server.py
    ```
2.  **에어컨 연결 시도:** 에어컨을 **Wi-Fi 설정 모드**로 변경하고, **SmartThings 앱**을 사용하여 네트워크 연결 절차를 진행합니다.
3.  **토큰 확인:** 에어컨이 Wi-Fi에 연결된 후 삼성 서버와 통신을 시도하면, DNS 설정 때문에 우리 PC의 가짜 서버로 접속하게 됩니다. 이때, 터미널 화면에 에어컨이 보낸 데이터와 함께 **`추출된 토큰: XXXXXXXX`** 이 출력됩니다.
4.  **설정 원복:** 토큰을 성공적으로 얻었다면, **반드시 2단계에서 변경했던 공유기의 DNS 설정을 삭제하여 원상 복구**해야 합니다.

---

## 설정

Homebridge UI의 플러그인 설정 화면에서 아래 항목들을 입력합니다. 인증서 경로 설정은 더 이상 필요 없습니다.

| 키 | 설명 | 필수 |
| :--- | :--- | :--- |
| `name` | 홈 앱에 표시될 에어컨의 이름. | 예 |
| `ip` | 에어컨의 고정 IP 주소. | 예 |
| `token`| 위에서 추출한 인증 토큰. | 예 |
| `deviceIndex` | (선택) 상태를 **읽어올** 장치의 인덱스(0부터). | 아니오 |
| `setDeviceIndex`| (선택) 명령을 **보낼** 장치의 인덱스. | 아니오 |

#### `config.json` 직접 수정 예시
```json
{
  "bridge": { ... },
  "accessories": [
    {
      "accessory": "SamsungAC",
      "name": "거실 에어컨",
      "ip": "192.168.1.3",
      "token": "YOUR-EXTRACTED-TOKEN-HERE",
      "deviceIndex": 1,
      "setDeviceIndex": 0
    },
    {
      "accessory": "SamsungAC",
      "name": "침실 에어컨",
      "ip": "192.168.1.3",
      "token": "YOUR-EXTRACTED-TOKEN-HERE",
      "deviceIndex": 0,
      "setDeviceIndex": 1
    }
  ]
}
```

### ⚠️ 보안 경고

이 플러그인은 오래된 보안 프로토콜(TLSv1)을 사용하여 에어컨과 통신합니다. 신뢰할 수 있는 **로컬 네트워크 환경에서만 사용**하시는 것을 강력히 권장합니다.
