# keepy — AI 캡처 정리

캡처를 던지면 AI가 알아서 분류하고 정리해주는 스마트 스크랩북

## 기능
- 📸 캡처 이미지 업로드 → AI 자동 분석 & 요약
- 📍 코스/일정 자동 감지 & 타임라인 시각화
- 📁 AI 폴더 추천 & 자동 분류
- ✏️ 빠른 메모 → AI 깔끔 정리
- 🔍 통합 검색 (제목, 태그, 내용)
- 📋 정리된 내용 복사
- 🔐 Google 로그인 (데모)
- 📱 PWA — 홈 화면 추가 & 공유하기로 바로 캡처 전송
- 📊 월 50회 AI 사용량 제한

## 배포 방법

### 1. GitHub에 올리기
```bash
cd keepy-app
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/keepy.git
git push -u origin main
```

### 2. Vercel 배포
1. [vercel.com](https://vercel.com) 접속 → GitHub 로그인
2. "Add New Project" 클릭
3. keepy 레포지토리 선택 → Import
4. Framework: Vite (자동 감지됨)
5. "Deploy" 클릭
6. 1~2분 후 배포 완료!

### 3. PWA 설치 (모바일)
1. 배포된 URL을 모바일 브라우저에서 열기
2. "홈 화면에 추가" 선택
3. 이제 공유하기 메뉴에 keepy가 나타남!
4. 캡처 후 공유 → keepy 선택 → 바로 AI 분석

### 4. 실제 서비스 연동 (선택)
- **Google 로그인**: Google Cloud Console → OAuth 2.0 설정
- **AI 분석**: Anthropic API 키 발급 → Vercel 환경 변수에 추가

## 로컬 개발
```bash
npm install
npm run dev
```

## 기술 스택
- React 18 + Vite
- Anthropic Claude API (이미지 분석)
- PWA (Service Worker + Web Share Target API)
- localStorage (데이터 저장)
