import importlib.util
import pathlib
import tempfile
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('configure_attachments',pathlib.Path(__file__).with_name('configure-attachments.py'))
configure=importlib.util.module_from_spec(spec)
spec.loader.exec_module(configure)
class ConfigureAttachmentsTests(unittest.TestCase):
    def test_runtime_env_preserves_credentials_and_other_lines(self):
        old='GRAYBOX_MODE=cloud\nGRAYBOX_DATABASE_URL=private\nOTHER=value\nGRAYBOX_ATTACHMENT_DIR=old\n'
        updated=configure.runtime_env(old)
        self.assertIn('GRAYBOX_DATABASE_URL=private\nOTHER=value\n',updated)
        self.assertEqual(updated.count('GRAYBOX_ATTACHMENT_DIR='),1)
        self.assertIn('GRAYBOX_ATTACHMENT_DIR=/var/lib/graybox/attachments',updated)
    def test_rejects_changes_to_shared_listener_or_system_write_access(self):
        root=pathlib.Path(__file__).parent
        unit=(root/'graybox.service').read_text()
        nginx=(root/'graybox.nginx.conf').read_text()
        configure.validate_templates(unit,nginx)
        for bad in [nginx.replace('listen 8443 ssl;','listen 443 ssl;'),nginx+'\nserver {listen 8080;}']:
            with self.assertRaises(ValueError):configure.validate_templates(unit,bad)
        with self.assertRaises(ValueError):configure.validate_templates(unit.replace('ReadWritePaths=/var/lib/graybox/attachments','ReadWritePaths=/var/lib'),nginx)
    def test_failed_apply_restores_all_scoped_configs_and_only_graybox_service(self):
        events=[]
        def run(args):
            events.append(args)
            if args==['nginx','-t']:raise RuntimeError('invalid candidate')
        restored=[]
        with patch.object(configure,'run',side_effect=run),patch.object(configure,'restore',side_effect=lambda saved:restored.append(saved)):
            with self.assertRaises(RuntimeError):
                with configure.config_recovery({'scoped':'backup'}):
                    configure.run(['systemctl','stop','graybox.service'])
                    configure.run(['nginx','-t'])
        self.assertEqual(restored,[{'scoped':'backup'}])
        self.assertIn(['systemctl','start','graybox.service'],events)
        self.assertFalse(any('meeting-assistant-public.service' in event for event in events))
    def test_atomic_write_replaces_target_and_retains_requested_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            target=pathlib.Path(directory)/'runtime.env'
            target.write_text('old')
            configure.atomic_write(target,b'new',0o600)
            self.assertEqual(target.read_bytes(),b'new')
            self.assertFalse(target.with_name(target.name+'.attachments-pending').exists())
    def test_atomic_write_refuses_and_preserves_existing_pending_file(self):
        with tempfile.TemporaryDirectory() as directory:
            target=pathlib.Path(directory)/'runtime.env'
            pending=target.with_name(target.name+'.attachments-pending');pending.write_bytes(b'earlier operation')
            with self.assertRaises(FileExistsError):configure.atomic_write(target,b'new',0o600)
            self.assertEqual(pending.read_bytes(),b'earlier operation')
if __name__=='__main__':unittest.main()
