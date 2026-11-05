const form=document.getElementById('login-form'),button=document.getElementById('login-button'),message=document.getElementById('login-message');
if(new URLSearchParams(location.search).get('changed')==='1')message.textContent='새로 설정한 관리자 비밀번호로 로그인해 주세요.';
form.addEventListener('submit',async event=>{
 event.preventDefault();if(button.disabled)return;button.disabled=true;message.textContent='로그인 확인 중';
 const input=document.getElementById('password'),password=input.value;input.value='';
 try{const response=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password}),credentials:'same-origin',cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error||'로그인을 다시 시도해 주세요.');location.replace('/admin/');}catch(error){message.textContent=error.message;button.disabled=false;}
});
