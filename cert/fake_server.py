#!/usr/bin/env python3
import ssl
import socket
import os
import threading

# 설정
LISTEN_IP = '0.0.0.0' # 모든 IP에서 들어오는 연결을 수신
HTTPS_PORT = 443
CERT_FILE = 'temp_server_cert.pem'
KEY_FILE = 'temp_server_key.pem'

def generate_self_signed_cert(cert_file, key_file):
    """임시 SSL 서버 인증서 생성"""
    if not (os.path.exists(cert_file) and os.path.exists(key_file)):
        print(f"임시 서버 인증서 '{cert_file}' 및 '{key_file}' 생성 중...")
        # openssl이 설치되어 있어야 함
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
                    print("\n" + "*"*20 + " 🎉 토큰 발견! 🎉 " + "*"*20)
                    token = line.split(' ')[-1]
                    print(f"추출된 토큰: {token}")
                    print("*"*56)
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
            threading.Thread(target=handle_client, args=(conn, addr)).start()

if __name__ == '__main__':
    try:
        main()
    except PermissionError:
        print("\n[오류] 443 포트를 사용하려면 root 권한이 필요합니다. 'sudo python3 fake_server.py'로 실행해주세요.")
    except KeyboardInterrupt:
        print("\n서버를 종료합니다.")
    finally:
        # 종료 시 임시 인증서 파일 삭제
        if os.path.exists(CERT_FILE): os.remove(CERT_FILE)
        if os.path.exists(KEY_FILE): os.remove(KEY_FILE)
