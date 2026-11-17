/** Recording labels; other locales use the English fallback until translated. */
export const recordingZh = {
  recordStart: '录音',
  recordStop: '结束并识别',
  recordCancel: '取消',
  recordStatus_idle: '点击录音，识别后可修改文字再发送。',
  recordStatus_permission: '正在请求麦克风权限…',
  recordStatus_recording: '正在录音，点击“结束并识别”转为文字。',
  recordStatus_recognizing: '正在识别语音，不会自动发送…',
  recordStatus_ready: '识别文字已填入输入框，请确认或修改后发送。',
  recordError_unsupported: '当前环境无法录音，请使用 HTTPS 或 localhost，并确认浏览器支持麦克风。',
  recordError_permission: '无法启动麦克风，请检查录音权限、设备是否可用，再点击录音重试。',
  recordError_failed: '语音识别失败，请检查语音识别服务配置后重试。',
  recordError_silent: '没有识别到语音，请录制一段清晰的语音。',
  recordError_limit: '录音已达到 200 秒上限，已取消且未提交识别，请缩短录音后重试。',
};

/** Complete English fallback for the recording control. */
export const recordingEn: Record<keyof typeof recordingZh, string> = {
  recordStart: 'Record',
  recordStop: 'Stop and transcribe',
  recordCancel: 'Cancel',
  recordStatus_idle: 'Record, then review or edit the transcript before sending.',
  recordStatus_permission: 'Requesting microphone permission…',
  recordStatus_recording: 'Recording. Click Stop and transcribe when finished.',
  recordStatus_recognizing: 'Transcribing. Your message will not be sent automatically…',
  recordStatus_ready: 'Transcript added. Review or edit it, then send.',
  recordError_unsupported: 'Recording requires HTTPS or localhost and a browser with microphone support.',
  recordError_permission: 'Could not start the microphone. Check permissions and the audio device, then try again.',
  recordError_failed: 'Transcription failed. Check speech recognition settings before trying again.',
  recordError_silent: 'No speech detected. Please record a clear utterance.',
  recordError_limit:
    'Recording reached the 200-second limit and was discarded without transcription. Try a shorter recording.',
};
