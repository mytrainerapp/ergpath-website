(() => {
  const form = document.getElementById('tester-form');
  if (!form) return;
  const status = document.getElementById('tester-status');
  const button = document.getElementById('tester-submit');
  let widget, loading, token = '', submitted = false;
  const message = text => { status.textContent = text; };
  async function prepare() {
    if (widget !== undefined) return;
    if (loading) return loading;
    loading = (async () => {
      const response = await fetch('/api/testers/config', {cache:'no-store',signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error('unavailable');
      const config = await response.json();
      if (!window.turnstile) await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        const timer = setTimeout(()=>{script.remove();reject(new Error('timeout'));},15000);
        script.onload = () => {clearTimeout(timer);resolve();};
        script.onerror = () => {clearTimeout(timer);script.remove();reject(new Error('blocked'));};
        document.head.appendChild(script);
      });
      widget = window.turnstile.render('#tester-challenge', {
        sitekey:config.sitekey,action:'testers',theme:'dark',size:'flexible',
        callback:value=>{token=value;if(!submitted)message('Security check complete. You can join the list.');},
        'expired-callback':()=>{token='';message('Security check expired. Please complete it again.');},
        'error-callback':()=>{token='';message('Security check could not load. Reload the page or contact support@ergpath.com.');}
      });
    })().finally(()=>{loading=null;});
    return loading;
  }
  // Load the anti-abuse service only when the visitor interacts with this form.
  form.addEventListener('focusin',()=>prepare().catch(()=>message('The form is temporarily unavailable. Please try again or contact support@ergpath.com.')));
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if (button.disabled || submitted || !form.reportValidity()) return;
    button.disabled=true;
    try {
      await prepare();
      if (!token) {message('Please complete the security check, then press Join the testing list.');return;}
      const data = new FormData(form);
      const response = await fetch('/api/testers/join', {
        method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),
        body:JSON.stringify({email:data.get('email'),consent:data.get('consent')==='on',company:data.get('company'),token})
      });
      const result = await response.json();
      if (response.ok && result.ok === true) {
        submitted=true;form.reset();button.textContent='YOU’RE ON THE LIST';
        message('You’re on the list. Check your inbox for the ERGPath download email, usually within 15 minutes. If you have already joined, your original invitation still applies. Check Junk or contact support@ergpath.com if you need help.');
        if(widget!==undefined)window.turnstile.remove(widget);
        return;
      }
      const messages = {
        invalid_email:'Please enter a valid email address.',consent_required:'Please tick the agreement to receive testing invitations and confirm you are 18 or over.',
        verification_required:'Please complete the new security check and try again.',
        too_many_requests:'Too many attempts. Please wait 10 minutes before trying again.',
        verification_unavailable:'The security check is temporarily unavailable. Please try again shortly.'
      };
      message(messages[result.error] || 'We couldn’t save your request. Please try again shortly or contact support@ergpath.com.');
    } catch {message('We couldn’t confirm your sign-up. Check your connection and try again. Repeating your request won’t create a duplicate.');}
    finally {button.disabled=submitted;if(!submitted && widget!==undefined){token='';window.turnstile.reset(widget);}}
  });
})();
