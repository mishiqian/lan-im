/**
 * 聊天窗样式表（设计系统 v3）。
 *
 * 令牌分层：
 *   1) 结构色映射宿主主题 --dsw-alias-*，跟随 DSH 深浅色；
 *   2) 品牌色只有一档：#22A5BE 用于「选中 / 链接 / 焦点」，
 *      实心主按钮用 #0E7490（白字 5.38:1，AA）。面积 ≤10%（A1/A5）；
 *   3) 语义色只做点缀：在线绿、错误红，都是浅底 + 深字（C2）。
 *
 * 布局：4/8pt 网格；侧栏单列滚动（频道与私聊同区）；消息区限宽 640 并底部对齐。
 */
export const CSS = `
.lim-window{
  --lim-bg:var(--dsw-alias-bg-layer-1,#15181f);
  --lim-surface:var(--dsw-alias-bg-layer-2,#1c212a);
  --lim-surface-2:color-mix(in srgb,var(--dsw-alias-bg-layer-2,#1c212a) 72%,#fff 6%);
  --lim-sidebar:color-mix(in srgb,var(--dsw-alias-bg-base,#101318) 62%,var(--dsw-alias-bg-layer-1,#15181f));
  --lim-fg:var(--dsw-alias-label-primary,#eef1f5);
  --lim-muted:var(--dsw-alias-label-secondary,#a3adbb);
  --lim-faint:color-mix(in srgb,var(--dsw-alias-label-secondary,#a3adbb) 74%,transparent);
  --lim-border:var(--dsw-alias-border-l1,rgba(255,255,255,.07));
  --lim-hover:color-mix(in srgb,var(--dsw-alias-label-primary,#fff) 8%,transparent);
  --lim-accent:#22A5BE;
  --lim-accent-solid:#0E7490;
  --lim-accent-weak:color-mix(in srgb,#22A5BE 14%,transparent);
  --lim-on-accent:#ffffff;
  --lim-danger:var(--dsw-alias-state-error-primary,#f87171);
  --lim-ok:var(--dsw-alias-state-success-primary,#34d399);
  position:fixed;z-index:2147483000;width:540px;max-width:calc(100vw - 16px);height:640px;max-height:calc(100vh - 16px);
  display:flex;flex-direction:column;background:var(--lim-bg);color:var(--lim-fg);
  border:1px solid var(--lim-border);border-radius:16px;overflow:hidden;
  box-shadow:0 32px 80px rgba(0,0,0,.42),0 4px 12px rgba(0,0,0,.28);
  font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;
  -webkit-font-smoothing:antialiased;
}
.lim-window *{box-sizing:border-box}
.lim-window ::selection{background:var(--lim-accent-weak)}

/* ---------- 顶栏 ---------- */
.lim-header{display:flex;align-items:center;gap:10px;height:54px;flex:none;padding:0 10px 0 16px;background:var(--lim-bg);border-bottom:1px solid var(--lim-border);cursor:move;user-select:none;touch-action:none}
.lim-mark{display:block;flex:none}
.lim-title{font-size:14.5px;font-weight:650;letter-spacing:.005em}
.lim-ver{font-size:10.5px;color:var(--lim-faint);font-weight:500;letter-spacing:.02em;margin-top:3px}
.lim-count{display:inline-flex;align-items:center;gap:6px;margin-left:4px;padding:4px 9px;border-radius:999px;background:var(--lim-hover);color:var(--lim-muted);font-size:11px;font-weight:500}
.lim-count::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--lim-ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--lim-ok) 18%,transparent)}
.lim-count.off::before{background:var(--lim-muted);box-shadow:none}
.lim-actions{margin-left:auto;display:flex;align-items:center;gap:2px}
.lim-iconbtn{display:grid;place-items:center;width:30px;height:30px;padding:0;border:none;border-radius:9px;background:transparent;color:var(--lim-muted);cursor:pointer;transition:background .12s ease,color .12s ease}
.lim-iconbtn:hover{background:var(--lim-hover);color:var(--lim-fg)}
.lim-iconbtn:focus-visible{outline:2px solid var(--lim-accent);outline-offset:1px}
.lim-iconbtn[aria-pressed="true"]{color:var(--lim-accent);background:var(--lim-accent-weak)}

/* ---------- 主体 ---------- */
.lim-body{flex:1;display:flex;min-height:0}
.lim-contacts{width:188px;flex:none;display:flex;flex-direction:column;min-height:0;background:var(--lim-sidebar);border-right:1px solid var(--lim-border)}
.lim-contacts-scroll{flex:1;min-height:0;overflow-y:auto;padding:10px 8px 8px;display:flex;flex-direction:column;gap:2px}
.lim-contact-scroll{flex:1;min-height:0;overflow-y:auto;padding:10px 8px 8px}
.lim-contacts-scroll::-webkit-scrollbar,.lim-dm-scroll::-webkit-scrollbar,.lim-messages::-webkit-scrollbar,.lim-shared-list::-webkit-scrollbar{width:8px}
.lim-contacts-scroll::-webkit-scrollbar-thumb,.lim-dm-scroll::-webkit-scrollbar-thumb,.lim-messages::-webkit-scrollbar-thumb,.lim-shared-list::-webkit-scrollbar-thumb{background:var(--lim-hover);border-radius:4px}
.lim-contacts-group{font-size:10.5px;font-weight:600;letter-spacing:.09em;color:var(--lim-faint);padding:14px 8px 6px;text-transform:uppercase}
.lim-contacts-group:first-child{padding-top:2px}
.lim-contact{display:flex;align-items:center;gap:9px;height:34px;padding:0 9px;border-radius:9px;cursor:pointer;color:var(--lim-muted);font-size:13.5px;transition:background .12s ease,color .12s ease}
.lim-contact:hover{background:var(--lim-hover);color:var(--lim-fg)}
.lim-contact:focus-visible{outline:2px solid var(--lim-accent);outline-offset:-2px}
.lim-contact.on{background:var(--lim-accent-weak);color:var(--lim-fg);font-weight:600}
.lim-cicon{flex:none;display:grid;place-items:center;width:16px;height:16px;color:var(--lim-faint)}
.lim-contact:hover .lim-cicon{color:var(--lim-muted)}
.lim-contact.on .lim-cicon{color:var(--lim-accent)}
.lim-cavatar{width:22px;height:22px;flex:none;border-radius:50%;display:grid;place-items:center;background:color-mix(in srgb,var(--lim-accent) 18%,var(--lim-surface));color:var(--lim-accent);font-size:10.5px;font-weight:700}
.lim-contact.on .lim-cavatar{background:var(--lim-accent-solid);color:var(--lim-on-accent)}
.lim-cdot{width:6px;height:6px;border-radius:50%;background:var(--lim-ok);flex:none}
.lim-contact-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lim-contact-badge{flex:none;min-width:17px;height:17px;padding:0 5px;border-radius:9px;background:var(--lim-accent-solid);color:var(--lim-on-accent);font-size:10px;line-height:17px;text-align:center;font-weight:700}
.lim-contact-mute{flex:none;color:var(--lim-faint);display:grid;place-items:center}
.lim-channel-act,.lim-channel-x{flex:none;display:grid;place-items:center;width:22px;height:22px;border:none;border-radius:6px;background:transparent;color:var(--lim-faint);cursor:pointer;opacity:0;transition:opacity .12s ease}
.lim-contact:hover .lim-channel-act,.lim-contact:focus-within .lim-channel-act,.lim-contact.on .lim-channel-act,
.lim-contact:hover .lim-channel-x,.lim-contact:focus-within .lim-channel-x{opacity:1}
.lim-channel-act:hover{background:var(--lim-hover);color:var(--lim-fg)}
.lim-channel-x:hover{background:var(--lim-hover);color:var(--lim-danger)}
.lim-newchannel{display:flex;align-items:center;gap:9px;height:34px;padding:0 9px;margin-top:2px;border:none;border-radius:9px;background:transparent;color:var(--lim-faint);font:inherit;font-size:13px;cursor:pointer;width:100%;text-align:left}
.lim-newchannel:hover{background:var(--lim-hover);color:var(--lim-fg)}
.lim-newchannel:focus-visible{outline:2px solid var(--lim-accent);outline-offset:-2px}
.lim-dm-group{display:flex;flex-direction:column;margin-top:6px}
.lim-dm-scroll{display:flex;flex-direction:column;gap:2px}

/* 侧栏底部「我」 */
.lim-me{flex:none;display:flex;align-items:center;gap:9px;height:56px;padding:0 12px;border-top:1px solid var(--lim-border);background:color-mix(in srgb,var(--lim-sidebar) 70%,#000 6%)}
.lim-me-avatar{width:26px;height:26px;flex:none;border-radius:50%;display:grid;place-items:center;background:var(--lim-accent-solid);color:var(--lim-on-accent);font-size:11px;font-weight:700}
.lim-me-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:600;cursor:pointer}
.lim-me-id{display:block;font-size:10.5px;font-weight:400;color:var(--lim-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px}
.lim-me-dot{width:6px;height:6px;flex:none;border-radius:50%;background:var(--lim-ok)}
.lim-me-dot.off{background:var(--lim-muted)}

/* ---------- 会话区 ---------- */
.lim-thread{flex:1;display:flex;flex-direction:column;min-width:0;background:var(--lim-bg)}
.lim-thread-title{flex:none;display:flex;align-items:center;gap:9px;height:48px;padding:0 10px 0 18px;border-bottom:1px solid var(--lim-border)}
.lim-thread-name{font-size:14px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lim-thread-desc{flex:1;min-width:0;font-size:11.5px;color:var(--lim-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lim-seg{display:flex;gap:2px;padding:3px;border-radius:9px;background:var(--lim-hover);margin-left:auto}
.lim-seg button{height:24px;padding:0 11px;border:none;border-radius:7px;background:transparent;color:var(--lim-muted);font:inherit;font-size:11.5px;cursor:pointer}
.lim-seg button.on{background:var(--lim-surface);color:var(--lim-fg);font-weight:600}
.lim-seg button:focus-visible{outline:2px solid var(--lim-accent);outline-offset:1px}

.lim-searchbar{flex:none;display:flex;gap:8px;padding:10px 16px;border-bottom:1px solid var(--lim-border);background:var(--lim-bg)}
.lim-messages{flex:1;overflow-y:auto;padding:16px 20px 10px;display:flex;flex-direction:column}
.lim-messages-inner{width:100%;max-width:600px;margin:auto auto 0;display:flex;flex-direction:column;gap:12px}
.lim-msg{max-width:86%;align-self:flex-start;display:flex;align-items:flex-start;gap:8px;position:relative;padding-bottom:26px;margin-bottom:-26px}
.lim-msg.mine{align-self:flex-end;flex-direction:row-reverse}
.lim-msg.compact{margin-top:-6px}
.lim-msg-avatar{width:28px;height:28px;flex:none;border-radius:50%;display:grid;place-items:center;background:color-mix(in srgb,var(--lim-accent) 20%,var(--lim-surface));color:var(--lim-accent);font-size:11px;font-weight:700;margin-top:2px}
.lim-msg-avatar.hidden{visibility:hidden}
.lim-msg.mine .lim-msg-avatar{background:var(--lim-accent-solid);color:var(--lim-on-accent)}
.lim-msg-main{display:flex;flex-direction:column;gap:4px;min-width:0;align-items:flex-start}
.lim-msg.mine .lim-msg-main{align-items:flex-end}
.lim-msg-meta{font-size:11.5px;color:var(--lim-faint);display:flex;gap:7px;align-items:center;padding:0 2px}
.lim-msg-meta b{font-weight:600;color:var(--lim-muted)}
.lim-msg.mine .lim-msg-meta{justify-content:flex-end}
.lim-bubble-wrap{position:relative;display:flex}
.lim-msg-tools{position:absolute;bottom:2px;right:0;display:flex;gap:1px;padding:2px;border-radius:8px;background:var(--lim-surface);border:1px solid var(--lim-border);box-shadow:0 6px 18px rgba(0,0,0,.28);opacity:0;pointer-events:none;transition:opacity .12s ease}
.lim-msg.mine .lim-msg-tools{right:auto;left:0}
.lim-msg:hover .lim-msg-tools,.lim-msg-tools:focus-within{opacity:1;pointer-events:auto}
.lim-tool{display:grid;place-items:center;width:26px;height:24px;border:none;border-radius:6px;background:transparent;color:var(--lim-muted);cursor:pointer}
.lim-tool:hover{background:var(--lim-hover);color:var(--lim-fg)}
.lim-tool.danger:hover{color:var(--lim-danger)}
.lim-tool:focus-visible{outline:2px solid var(--lim-accent);outline-offset:-2px}
.lim-bubble{padding:9px 13px;border-radius:14px;border-bottom-left-radius:5px;background:var(--lim-surface);color:var(--lim-fg);font-size:14px;line-height:1.62;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere}
.lim-msg.mine .lim-bubble{background:var(--lim-accent-solid);color:var(--lim-on-accent);border-radius:14px;border-bottom-right-radius:5px}
.lim-quote{display:flex;flex-direction:column;gap:2px;margin-bottom:7px;padding:6px 9px;border-radius:8px;background:color-mix(in srgb,var(--lim-fg) 10%,transparent);font-size:12px;line-height:1.5;max-width:100%}
.lim-msg.mine .lim-quote{background:color-mix(in srgb,#000 16%,transparent)}
.lim-quote-name{font-weight:600;color:inherit;opacity:.95}
.lim-quote-body{opacity:.72;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lim-bubble.recalled{font-style:italic;opacity:.55}
.lim-msg-act{flex:none;font-size:11px;color:var(--lim-faint);cursor:pointer;opacity:0;background:none;border:none;padding:0 3px}
.lim-msg:hover .lim-msg-act,.lim-msg-act:focus-visible{opacity:1}
.lim-msg-act:hover{color:var(--lim-fg)}
.lim-sys{align-self:center;font-size:11px;color:var(--lim-faint);padding:3px 10px;max-width:90%;text-align:center;background:var(--lim-hover);border-radius:999px}

.lim-file{max-width:82%;align-self:flex-start;display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:14px;border-bottom-left-radius:5px;background:var(--lim-surface)}
.lim-file.mine{align-self:flex-end;border-radius:14px;border-bottom-right-radius:5px}
.lim-file-icon{display:grid;place-items:center;width:30px;height:30px;flex:none;border-radius:9px;background:var(--lim-hover);color:var(--lim-muted)}
.lim-file-body{display:flex;flex-direction:column;gap:6px;width:100%}
.lim-file-img{max-width:220px;max-height:220px;border-radius:10px;object-fit:contain;background:var(--lim-hover)}
.lim-file-caption{font-size:11px;color:var(--lim-muted)}
.lim-file-meta{flex:1;min-width:0}
.lim-file-name{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lim-file-size{font-size:11px;color:var(--lim-faint)}
.lim-file-dl{display:grid;place-items:center;width:26px;height:26px;flex:none;border-radius:7px;color:var(--lim-muted);text-decoration:none}
.lim-file-dl:hover{background:var(--lim-hover);color:var(--lim-fg)}

/* ---------- 空状态 ---------- */
.lim-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:32px;color:var(--lim-muted);text-align:center;min-height:220px}
.lim-empty-art{opacity:.6}
.lim-empty-title{font-size:14px;font-weight:600;color:var(--lim-muted)}
.lim-empty-hint{font-size:12px;color:var(--lim-faint);max-width:260px;line-height:1.7}

/* ---------- 输入区 ---------- */
.lim-inputbar{flex:none;display:flex;align-items:flex-end;gap:6px;padding:10px 12px 14px;background:var(--lim-bg)}
.lim-replybar{flex:none;display:flex;align-items:center;gap:8px;padding:8px 14px;background:var(--lim-surface);border-top:1px solid var(--lim-border)}
.lim-replybar-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.lim-replybar-name{font-size:11.5px;color:var(--lim-accent);font-weight:600}
.lim-replybar-body{font-size:11.5px;color:var(--lim-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lim-replybar-x{display:grid;place-items:center;width:22px;height:22px;flex:none;border:none;border-radius:6px;background:transparent;color:var(--lim-faint);cursor:pointer}
.lim-replybar-x:hover{background:var(--lim-hover);color:var(--lim-fg)}
.lim-editbar{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 14px;font-size:12px;color:var(--lim-muted);background:var(--lim-accent-weak);border-top:1px solid var(--lim-border)}
.lim-editbar button{border:none;background:none;color:var(--lim-accent);font:inherit;font-size:12px;cursor:pointer;padding:2px 6px;border-radius:6px}
.lim-editbar button:hover{background:var(--lim-hover)}
.lim-upload{display:flex;flex-direction:column;gap:6px;align-self:flex-end;width:min(320px,86%);padding:10px 12px;border-radius:12px;background:var(--lim-surface);border:1px solid var(--lim-border)}
.lim-upload-head{display:flex;align-items:center;gap:8px}
.lim-upload-name{flex:1;min-width:0;font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lim-upload-x{display:grid;place-items:center;width:20px;height:20px;border:none;border-radius:6px;background:transparent;color:var(--lim-faint);cursor:pointer}
.lim-upload-x:hover{background:var(--lim-hover);color:var(--lim-fg)}
.lim-upload-bar{height:4px;border-radius:2px;background:var(--lim-hover);overflow:hidden}
.lim-upload-bar span{display:block;height:100%;background:var(--lim-accent);transition:width .15s ease}
.lim-upload-sub{font-size:11px;color:var(--lim-faint)}
.lim-dropzone{position:absolute;inset:0;z-index:60;display:grid;place-items:center;background:color-mix(in srgb,var(--lim-bg) 78%,transparent);backdrop-filter:blur(2px);border:2px dashed var(--lim-accent);border-radius:16px;pointer-events:none}
.lim-dropzone-box{display:flex;flex-direction:column;align-items:center;gap:10px;color:var(--lim-accent);font-size:13px;font-weight:600}
.lim-attach{display:grid;place-items:center;width:30px;height:34px;flex:none;border-radius:10px;color:var(--lim-muted);cursor:pointer}
.lim-attach:hover{background:var(--lim-hover);color:var(--lim-fg)}
.lim-attach:focus-within{outline:2px solid var(--lim-accent);outline-offset:1px}
.lim-input{flex:1;min-width:0;padding:10px 12px;font:inherit;font-size:13.5px;line-height:1.5;color:var(--lim-fg);background:var(--lim-surface);border:1px solid transparent;border-radius:12px;outline:none}
.lim-composer{resize:none;max-height:132px;min-height:36px;overflow-y:hidden;font-family:inherit}
.lim-input::placeholder{color:var(--lim-faint)}
.lim-input:hover{border-color:var(--lim-border)}
.lim-input:focus{border-color:var(--lim-accent);box-shadow:0 0 0 3px var(--lim-accent-weak)}
.lim-send{display:grid;place-items:center;height:36px;min-width:38px;padding:0 9px;border:none;border-radius:10px;background:var(--lim-accent-solid);color:var(--lim-on-accent);font:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:filter .12s ease}
.lim-send:hover{filter:brightness(1.12)}
.lim-send:focus-visible{outline:2px solid var(--lim-accent);outline-offset:2px}
.lim-send:disabled{background:var(--lim-hover);color:var(--lim-faint);cursor:not-allowed;filter:none}
.lim-send.danger{background:var(--lim-danger)}
.lim-cta{align-self:flex-end;height:38px;min-width:100px;font-size:13.5px}

.lim-error{position:absolute;left:14px;right:14px;bottom:68px;padding:9px 12px;border-radius:10px;background:color-mix(in srgb,var(--lim-danger) 14%,var(--lim-bg));border:1px solid color-mix(in srgb,var(--lim-danger) 36%,transparent);color:var(--lim-fg);font-size:12px;z-index:2}

/* ---------- 弹层 ---------- */
.lim-modal{position:absolute;inset:0;z-index:40;display:grid;place-items:center;background:rgba(6,8,12,.6);backdrop-filter:blur(2px)}
.lim-modal-box{display:flex;flex-direction:column;gap:14px;width:320px;max-width:calc(100% - 32px);padding:20px;border-radius:16px;background:var(--lim-bg);border:1px solid var(--lim-border);box-shadow:0 24px 64px rgba(0,0,0,.5)}
.lim-modal-box.wide{width:400px;max-width:calc(100% - 32px)}
.lim-form-modal{width:400px;max-width:calc(100% - 32px);max-height:calc(100% - 32px);overflow-y:auto;gap:18px}
.lim-modal-head{display:flex;align-items:flex-start;gap:12px}
.lim-modal-title{font-size:16px;font-weight:650;line-height:1.4}
.lim-modal-sub{font-size:12px;color:var(--lim-faint);margin-top:2px}
.lim-modal-head .lim-iconbtn{margin-left:auto;flex:none}
.lim-select{width:100%;padding:9px 12px;font:inherit;font-size:13.5px;color:var(--lim-fg);background:var(--lim-surface);border:1px solid transparent;border-radius:10px;outline:none;appearance:none;background-image:linear-gradient(45deg,transparent 50%,var(--lim-muted) 50%),linear-gradient(135deg,var(--lim-muted) 50%,transparent 50%);background-position:calc(100% - 17px) 50%,calc(100% - 12px) 50%;background-size:5px 5px,5px 5px;background-repeat:no-repeat;cursor:pointer}
.lim-select:focus{border-color:var(--lim-accent);box-shadow:0 0 0 3px var(--lim-accent-weak)}
.lim-danger-zone{border-top:1px solid var(--lim-border);padding-top:16px}
.lim-mini.danger{color:var(--lim-danger);border-color:color-mix(in srgb,var(--lim-danger) 35%,transparent)}
.lim-mini.danger:hover{background:color-mix(in srgb,var(--lim-danger) 12%,transparent);color:var(--lim-danger)}
.lim-member-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lim-modal-actions{display:flex;gap:8px;justify-content:flex-end}
.lim-modal .lim-send{min-width:68px}
.lim-modal .lim-send.ghost{background:transparent;color:var(--lim-muted);border:1px solid var(--lim-border)}
.lim-modal .lim-send.ghost:hover{color:var(--lim-fg);background:var(--lim-hover)}
.lim-member-list{display:flex;flex-direction:column;gap:4px;max-height:150px;overflow-y:auto}
.lim-member{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:9px;background:var(--lim-surface);font-size:12.5px}
.lim-member-owner{margin-left:auto;font-size:11px;color:var(--lim-faint)}

/* ---------- 诊断日志 ---------- */
.lim-log{max-height:140px;overflow-y:auto;padding:10px 16px;border-bottom:1px solid var(--lim-border);background:var(--lim-sidebar);font:11px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace}
.lim-logline{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--lim-muted)}

/* ---------- 建号 ---------- */
.lim-setup{flex:1;display:flex;flex-direction:column;gap:20px;padding:26px;overflow-y:auto}
.lim-setup-hero{display:flex;align-items:center;gap:14px;padding-bottom:4px}
.lim-setup .lim-section{gap:7px}
.lim-setup .lim-profile-head{gap:14px}
.lim-avatar{width:46px;height:46px;flex:none;border-radius:50%;display:grid;place-items:center;background:var(--lim-accent-solid);color:var(--lim-on-accent);font-size:15px;font-weight:700}
.lim-setup-title{font-size:16px;font-weight:650}
.lim-setup-hint{font-size:12px;color:var(--lim-muted);line-height:1.75}
.lim-warn{color:var(--lim-danger)}
.lim-field{display:flex;flex-direction:column;gap:7px}
.lim-field label{font-size:12px;font-weight:500;color:var(--lim-muted)}

/* ---------- 个人中心 ---------- */
.lim-profile{width:420px;max-width:calc(100% - 24px);height:min(560px,calc(100% - 32px));padding:0;gap:0;overflow:hidden}
.lim-profile-head{display:flex;align-items:center;gap:14px;padding:20px 20px 14px}
.lim-profile-id{flex:1;min-width:0}
.lim-profile-name{font-size:17px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lim-profile-account{font-size:12px;color:var(--lim-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lim-profile-tabs{display:flex;gap:2px;padding:0 16px;border-bottom:1px solid var(--lim-border)}
.lim-profile-tabs button{position:relative;height:34px;padding:0 12px;border:none;background:none;color:var(--lim-muted);font:inherit;font-size:13px;cursor:pointer;border-radius:8px 8px 0 0}
.lim-profile-tabs button:hover{color:var(--lim-fg);background:var(--lim-hover)}
.lim-profile-tabs button.on{color:var(--lim-fg);font-weight:600}
.lim-profile-tabs button.on::after{content:'';position:absolute;left:10px;right:10px;bottom:-1px;height:2px;border-radius:2px;background:var(--lim-accent)}
.lim-profile-tabs button:focus-visible{outline:2px solid var(--lim-accent);outline-offset:-2px}
.lim-profile-body{flex:1;min-height:0;overflow-y:auto;padding:18px 20px;display:flex;flex-direction:column;gap:18px}
.lim-profile-foot{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 20px;border-top:1px solid var(--lim-border);background:color-mix(in srgb,var(--lim-bg) 92%,#fff 3%)}
.lim-profile-version{font-size:11px;color:var(--lim-faint)}
.lim-section{display:flex;flex-direction:column;gap:8px}
.lim-section-title{font-size:12px;font-weight:600;color:var(--lim-fg)}
.lim-section-hint{font-size:11.5px;color:var(--lim-faint);line-height:1.65}
.lim-kv{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:9px;background:var(--lim-surface);min-width:0}
.lim-kv-label{flex:none;font-size:11.5px;color:var(--lim-muted);min-width:56px}
.lim-kv-value{flex:1;min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--lim-fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lim-copybtn{flex:none;border:none;background:none;color:var(--lim-accent);font:inherit;font-size:11.5px;cursor:pointer;padding:2px 4px;border-radius:5px}
.lim-copybtn:hover{background:var(--lim-accent-weak)}
.lim-copybtn:focus-visible{outline:2px solid var(--lim-accent);outline-offset:1px}
.lim-hub-state{display:flex;align-items:center;gap:8px;padding:9px 12px;border-radius:10px;background:var(--lim-surface);font-size:13px;color:var(--lim-muted)}
.lim-hub-state.on{background:color-mix(in srgb,var(--lim-ok) 12%,transparent);color:var(--lim-ok)}
.lim-hub-state.off{background:color-mix(in srgb,var(--lim-danger) 10%,transparent);color:var(--lim-danger)}
.lim-hub-state.idle{background:var(--lim-surface);color:var(--lim-muted)}
.lim-hub-dot{width:7px;height:7px;border-radius:50%;background:currentColor;flex:none}
.lim-hub-error{font-size:11.5px;color:var(--lim-danger);line-height:1.6;word-break:break-word}
.lim-profile-status{display:flex;gap:6px;flex-wrap:wrap}
.lim-pill{font-size:11.5px;padding:4px 9px;border-radius:999px;background:var(--lim-hover);color:var(--lim-muted)}
.lim-pill.on{background:color-mix(in srgb,var(--lim-ok) 14%,transparent);color:var(--lim-ok);font-weight:600}
.lim-profile-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.lim-stat{display:flex;flex-direction:column;gap:3px;padding:11px;border-radius:11px;background:var(--lim-surface);min-width:0}
.lim-stat b{font-size:15px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lim-stat b.lim-stat-text{font-size:13.5px}
.lim-stat span{font-size:11px;color:var(--lim-faint)}
.lim-row{display:flex;align-items:center;gap:8px}
.lim-mini{border:1px solid var(--lim-border);background:transparent;color:var(--lim-muted);font:inherit;font-size:11.5px;padding:7px 11px;border-radius:9px;cursor:pointer;white-space:nowrap}
.lim-mini:hover{color:var(--lim-fg);background:var(--lim-hover)}
.lim-mini:disabled{opacity:.5;cursor:not-allowed}
.lim-profile-hint{font-size:11.5px;color:var(--lim-faint);line-height:1.7}
.lim-settings{flex:none;display:flex;flex-direction:column;gap:8px;padding:12px;border-bottom:1px solid var(--lim-border);background:var(--lim-sidebar)}

/* ---------- 共享文件 ---------- */
.lim-shared-list{flex:1;overflow-y:auto;padding:14px 18px;display:flex;flex-direction:column;gap:8px}
.lim-shared-file{display:flex;align-items:center;gap:11px;padding:11px;border-radius:11px;background:var(--lim-surface)}
.lim-shared-icon{display:grid;place-items:center;width:34px;height:34px;flex:none;border-radius:9px;background:var(--lim-hover);color:var(--lim-muted)}
.lim-shared-img{width:42px;height:42px;object-fit:cover;border-radius:9px;background:var(--lim-hover)}
.lim-shared-meta{flex:1;min-width:0}
.lim-shared-name{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lim-shared-sub{font-size:11px;color:var(--lim-faint)}
.lim-shared-act{display:grid;place-items:center;font-size:11.5px;color:var(--lim-muted);text-decoration:none;cursor:pointer;border:none;background:transparent;padding:6px 9px;border-radius:7px;font-family:inherit}
.lim-shared-act.danger{color:var(--lim-danger)}
.lim-shared-act:hover{background:var(--lim-hover);color:var(--lim-fg)}
.lim-shared-hint{flex:1;font-size:11.5px;color:var(--lim-faint)}

/* ---------- 拖拽边 / 悬浮球 ---------- */
.lim-resize-e{position:absolute;right:0;top:0;bottom:20px;width:6px;cursor:ew-resize;z-index:30;touch-action:none}
.lim-resize-s{position:absolute;left:0;bottom:0;right:20px;height:6px;cursor:ns-resize;z-index:30;touch-action:none}
.lim-resize-se{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;z-index:30;touch-action:none}
.lim-launcher{position:fixed;right:20px;bottom:20px;z-index:2147483001;width:50px;height:50px;border:none;border-radius:50%;background:var(--lim-accent-solid);color:#fff;cursor:pointer;box-shadow:0 10px 28px rgba(14,116,144,.45);display:grid;place-items:center;transition:transform .12s ease,filter .12s ease}
.lim-launcher:hover{filter:brightness(1.1);transform:translateY(-1px)}
.lim-launcher:focus-visible{outline:2px solid #fff;outline-offset:3px}
.lim-badge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--lim-danger);color:#fff;font-size:11px;line-height:18px;text-align:center;font-weight:700}

/* 窄窗口：侧栏收窄、气泡占满 */
@media (max-width:520px){
  .lim-contacts{width:172px}
  .lim-messages{padding:12px 14px 8px}
  .lim-thread-desc{display:none}
  .lim-msg{max-width:92%}
}
@media (prefers-reduced-motion:reduce){.lim-window *,.lim-window *::before,.lim-window *::after{transition:none!important;animation:none!important}}
`
