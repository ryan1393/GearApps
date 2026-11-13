#!/usr/bin/env python3
"""Windows deploy orchestration regressions using PowerShell and local fake transports.

Run on Linux with PowerShell 7 installed:
    PWSH_BIN=/path/to/pwsh python3 TEST-DEPLOY-TRUCKLOG-WINDOWS.py
No SSH connection, real Docker operation, or deployment is performed.
"""
import base64,hashlib,json,os,pathlib,shutil,subprocess,tempfile,unittest,urllib.parse
ROOT=pathlib.Path(__file__).resolve().parent;PWSH=os.environ.get('PWSH_BIN') or shutil.which('pwsh')
DB='D'*64;PROXY='P'*64;RXO='quoted_secret_example$'
@unittest.skipUnless(os.name=='posix' and PWSH, 'Requires a POSIX host and PowerShell 7 (set PWSH_BIN).')
class DeploymentTests(unittest.TestCase):
 def fixture(self,explicit=True,endpoint='ssh://fixture@linux.test:2222',overrides=None,fail='',extra='',tamper=False,private=False,legacy=False):
  temp=tempfile.TemporaryDirectory(prefix='trucklog-scp-review-');self.addCleanup(temp.cleanup);t=pathlib.Path(temp.name);repo=t/'source folder';repo.mkdir();app=repo/'truck-log';app.mkdir();home=t/'remote home with spaces';home.mkdir();bin=t/'bin';bin.mkdir();old=t/'old work folder';old.mkdir()
  script=ROOT/'DEPLOY-TRUCKLOG-LINUX.ps1';shutil.copy(script,repo/script.name)
  files={'truck-log/VERSION':'1.0.3\n','truck-log/SETUP-TRUCK-LOG.sh':'#!/bin/sh\nexit 0\n','truck-log/MANIFEST-SHA256.txt':'fixture\n','DEPLOY-TRUCKLOG-LINUX.py':'# fixture bootstrap; fake python records invocation\n','truck-log/.env.example':'EXAMPLE=yes\n','release-note.txt':'source fixture\n'}
  if private:files['truck-log/.env']='PRIVATE=must-never-archive\n'
  entries=[]
  for rel,text in files.items():
   p=repo/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text);entries.append(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+rel+'\n')
  (repo/'SHA256SUMS.txt').write_text(''.join(entries))
  if tamper:(repo/'release-note.txt').write_text('tampered\n')
  envtext='TRUCK_LOG_DATABASE_USERNAME=fixture\nTRUCK_LOG_DATABASE_PASSWORD='+DB+'\nTRUCK_LOG_DATABASE_NAME=TruckLog\nTRUCK_LOG_ADMIN_PROXY_KEY='+PROXY+'\nRXO_PASSWORD="'+RXO+'" # valid inline comment\n'+extra
  source=old/'.env';source.write_text(envtext);before=source.read_bytes();(app/'.env').write_text('DESTINATION_ENV_NOT_TO_ARCHIVE\n')
  mock=r'''#!/usr/bin/python3
import os,sys,pathlib,json,subprocess,shutil
args=sys.argv[1:];name=pathlib.Path(sys.argv[0]).name
stdin_text=sys.stdin.read() if name=='ssh' and args[-2:]==['sh','-s'] else ''
with open(os.environ['FAKE_CALLS'],'a') as f:f.write(json.dumps({'name':name,'args':args,'stdin':stdin_text})+'\n')
if name=='docker':
 if args[:2]==['context','show']:print('selected-fixture-context')
 elif args[:2]==['context','inspect']:
  print('harmless diagnostic on stderr',file=sys.stderr);print(json.dumps(os.environ['FAKE_ENDPOINT']))
 else:sys.exit(99)
 sys.exit(0)
if name=='scp':
 source,dest=args[-2:];dest=dest.split(':',1)[1]
 if os.environ.get('FAKE_FAIL')=='scp-env' and dest.endswith('old.env'):
  print('upload failed password='+os.environ['FAKE_DB'],file=sys.stderr);sys.exit(42)
 target=pathlib.Path(os.environ['HOME'])/dest;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
 if os.environ.get('FAKE_FAIL')=='launch' and dest.endswith('DEPLOY-TRUCKLOG-LINUX.py'):(pathlib.Path(sys.argv[0]).parent/'ssh').chmod(0o600)
 sys.exit(0)
if name=='ssh':
 command=stdin_text if args[-2:]==['sh','-s'] else args[-1]
 if os.environ.get('FAKE_SSH_CRLF')=='yes':command=command.replace('\r\n','\n').replace('\n','\r\n')
 if os.environ.get('FAKE_FAIL')=='prepare' and 'command -v' in command:sys.exit(255)
 sys.exit(subprocess.run(['/bin/sh','-s'],input=command,text=True,env=os.environ).returncode)
if name=='python3':
 import zipfile,stat,hashlib,base64,urllib.parse
 p=pathlib.Path(args[0]);stage=p.parent;assert stat.S_IMODE(stage.stat().st_mode)==0o700
 ep=pathlib.Path(args[args.index('--env-file')+1]);assert stat.S_IMODE(ep.stat().st_mode)==0o600
 zp=pathlib.Path(args[args.index('--archive')+1]);expected=args[args.index('--sha256')+1];assert hashlib.sha256(zp.read_bytes()).hexdigest()==expected
 with zipfile.ZipFile(zp) as z:
  names=z.namelist();assert 'truck-log/.env' not in names and 'truck-log/.env.example' in names and 'SHA256SUMS.txt' in names
 pathlib.Path(os.environ['FAKE_RESULT']).write_text(json.dumps({'stage':str(stage),'entries':names,'env':ep.read_text()}))
 print('Build stage diagnostic: fixture Dockerfile line 12 failed',flush=True)
 if os.environ.get('FAKE_ECHO')=='yes':
  for key in ['FAKE_DB','FAKE_PROXY','FAKE_RXO']:
   secret=os.environ[key]
   for value in [secret,urllib.parse.quote(secret,safe=''),base64.b64encode(secret.encode()).decode()]:print('native-secret='+value,file=sys.stderr,flush=True)
 sys.exit(19 if os.environ.get('FAKE_FAIL')=='remote' else 0)
'''
  for name in ['ssh','scp','docker','python3']:(bin/name).write_text(mock);(bin/name).chmod(0o755)
  env=os.environ.copy();env.update({'PATH':str(bin)+os.pathsep+env['PATH'],'HOME':str(home),'FAKE_CALLS':str(t/'calls.jsonl'),'FAKE_RESULT':str(t/'result.json'),'FAKE_ENDPOINT':endpoint,'FAKE_FAIL':fail,'FAKE_ECHO':'no','FAKE_DB':DB,'FAKE_PROXY':PROXY,'FAKE_RXO':RXO});env.pop('DOCKER_HOST',None);env.pop('DOCKER_CONTEXT',None)
  if overrides:env.update(overrides)
  command=[PWSH,'-NoLogo','-NoProfile','-File',str(repo/script.name),'-OldEnv',str(source),'-AppFolder',str(repo)]
  if explicit:command+=['-Server',endpoint]
  if legacy:
   driver=t/'legacy.ps1';quoted=lambda v:"'"+str(v).replace("'","''")+"'"
   invoke='& '+quoted(repo/script.name)+' -OldEnv '+quoted(source)+' -AppFolder '+quoted(repo)
   if explicit:invoke+=' -Server '+quoted(endpoint)
   driver.write_text("$PSNativeCommandArgumentPassing = 'Legacy'\n"+invoke+'\nexit $LASTEXITCODE\n');command=[PWSH,'-NoLogo','-NoProfile','-File',str(driver)]
  r=subprocess.run(command,env=env,text=True,capture_output=True,timeout=45)
  calls=[json.loads(x) for x in (t/'calls.jsonl').read_text().splitlines()] if (t/'calls.jsonl').exists() else []
  result=json.loads((t/'result.json').read_text()) if (t/'result.json').exists() else None
  self.assertEqual(source.read_bytes(),before,'source .env changed')
  for c in calls:
   joined=json.dumps(c['args']);self.assertNotIn(DB,joined);self.assertNotIn(PROXY,joined)
  return r,calls,result
 def test_explicit_server_spaces_port_zip_and_private_remote_env(self):
  r,calls,result=self.fixture();self.assertEqual(r.returncode,0,r.stdout+r.stderr);self.assertIsNotNone(result);self.assertFalse(any(c['name']=='docker' for c in calls));ssh=[c['args'] for c in calls if c['name']=='ssh'];self.assertEqual(len(ssh),2);self.assertIn('2222',ssh[0]);self.assertIn('fixture@linux.test',ssh[0]);self.assertIn('chmod 600',next(c for c in reversed(calls) if c['name']=='ssh').get('stdin') or ssh[-1][-1]);self.assertEqual(len([c for c in calls if c['name']=='scp']),3)
 def test_legacy_powershell_argument_passing_keeps_remote_quotes_and_home_spaces(self):
  r,calls,result=self.fixture(legacy=True,overrides={'FAKE_SSH_CRLF':'yes'});self.assertEqual(r.returncode,0,r.stdout+r.stderr);self.assertIsNotNone(result)
  ssh=[c for c in calls if c['name']=='ssh'];self.assertEqual(len(ssh),2);self.assertTrue(all(c['args'][-2:]==['sh','-s'] and c.get('stdin') for c in ssh))
 def test_context_inspection_keeps_stderr_out_of_json(self):
  r,calls,result=self.fixture(explicit=False,overrides={'DOCKER_CONTEXT':'chosen'});self.assertEqual(r.returncode,0,r.stdout+r.stderr);self.assertIsNotNone(result);self.assertTrue(any(c['name']=='docker' and c['args'][:2]==['context','inspect'] for c in calls))
 def test_redaction_never_changes_machine_context_or_ssh_username(self):
  r,calls,result=self.fixture(explicit=False,extra='RXO_USERNAME=fixture\n');self.assertEqual(r.returncode,0,r.stdout+r.stderr);self.assertIsNotNone(result)
  self.assertTrue(any(c['name']=='docker' and c['args'][:3]==['context','inspect','selected-fixture-context'] for c in calls))
  self.assertTrue(any(c['name']=='ssh' and 'fixture@linux.test' in c['args'] for c in calls));self.assertNotIn('selected-fixture-context',r.stdout+r.stderr);self.assertNotIn('fixture@linux.test',r.stdout+r.stderr)
 def test_docker_host_override_wins_when_no_context_override(self):
  r,calls,result=self.fixture(explicit=False,overrides={'DOCKER_HOST':'ssh://override@effective.test:2200'});self.assertEqual(r.returncode,0,r.stdout+r.stderr);self.assertTrue(any(c['name']=='ssh' and 'override@effective.test' in c['args'] and '2200' in c['args'] for c in calls));self.assertFalse(any(c['name']=='docker' and c['args'][:2]==['context','inspect'] for c in calls))
 def test_prepare_failure_preserves_exit_and_stops_transfers(self):
  r,calls,result=self.fixture(fail='prepare');self.assertEqual(r.returncode,255,r.stdout+r.stderr);self.assertFalse(any(c['name']=='scp' for c in calls));self.assertIsNone(result)
 def test_env_upload_failure_stops_before_bootstrap_and_redacts(self):
  r,calls,result=self.fixture(fail='scp-env');self.assertEqual(r.returncode,42,r.stdout+r.stderr);self.assertNotIn(DB,r.stdout+r.stderr);self.assertEqual(len([c for c in calls if c['name']=='ssh']),1);self.assertIsNone(result)
 def test_final_ssh_launch_failure_cannot_reuse_previous_scp_success(self):
  r,calls,result=self.fixture(fail='launch');self.assertNotEqual(r.returncode,0,r.stdout+r.stderr);self.assertIsNone(result);self.assertNotIn('Linux deployment completed.',r.stdout+r.stderr)
 def test_remote_failure_preserves_diagnostics_and_exit(self):
  r,calls,result=self.fixture(fail='remote');self.assertEqual(r.returncode,19,r.stdout+r.stderr);self.assertIn('Build stage diagnostic',r.stdout+r.stderr);self.assertIsNotNone(result)
 def test_same_length_and_quoted_inline_comment_secret_variants_redacted(self):
  r,calls,result=self.fixture(overrides={'FAKE_ECHO':'yes'});self.assertEqual(r.returncode,0,r.stdout+r.stderr)
  for secret in [DB,PROXY,RXO]:
   for form in [secret,urllib.parse.quote(secret,safe=''),base64.b64encode(secret.encode()).decode()]:self.assertNotIn(form,r.stdout+r.stderr,'secret leaked')
 def test_source_hash_mismatch_prevents_any_ssh(self):
  r,calls,result=self.fixture(tamper=True);self.assertNotEqual(r.returncode,0);self.assertFalse(any(c['name'] in ['ssh','scp'] for c in calls));self.assertIsNone(result)
 def test_private_manifest_path_prevents_any_ssh(self):
  r,calls,result=self.fixture(private=True);self.assertNotEqual(r.returncode,0);self.assertFalse(any(c['name'] in ['ssh','scp'] for c in calls));self.assertIsNone(result)
 def test_target_shell_option_is_rejected(self):
  r,calls,result=self.fixture(endpoint='-oProxyCommand=bad');self.assertNotEqual(r.returncode,0);self.assertFalse(any(c['name'] in ['ssh','scp'] for c in calls))
if __name__=='__main__':unittest.main(verbosity=2)
