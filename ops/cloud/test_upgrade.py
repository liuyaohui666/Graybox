import importlib.util
import os
import pathlib
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('upgrade', pathlib.Path(__file__).with_name('upgrade.py'))
upgrade = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upgrade)


class UpgradeTests(unittest.TestCase):
    def test_rejects_outside_release_and_unexpected_database(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / 'releases').mkdir()
            inside = root / 'releases' / 'old'
            inside.mkdir()
            self.assertEqual(upgrade.checked_release(inside, root), inside)
            with self.assertRaises(ValueError):
                upgrade.checked_release(root, root)

    @unittest.skipIf(os.name == 'nt', 'Native symlinks require Windows privilege; exercised on Linux deployment host')
    def test_symlink_escape_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / 'releases').mkdir()
            (root / 'releases' / 'escape').symlink_to(root, target_is_directory=True)
            with self.assertRaises(ValueError):
                upgrade.checked_release(root / 'releases' / 'escape', root)

    def test_additive_migration_must_preserve_old_nested_values(self):
        before = {'id': 'old', 'data': {'name': 'Original', 'status': 'active'}, 'revision': 3}
        after = {**before, 'creator_id': 'owner', 'data': {**before['data'], 'tags': [], 'priority': 'medium'}}
        self.assertTrue(upgrade.preserves(before, after))
        after['data']['name'] = 'Changed'
        self.assertFalse(upgrade.preserves(before, after))

    def test_migration_files_are_sorted_and_bounded(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            for name in ['005_team_social.sql', '004_personal_avatars.sql', '003_project_library.sql', '001_m1.sql', '002_cloud_auth.sql']:
                (root / name).write_text('SELECT 1;', encoding='utf8')
            self.assertEqual([p.name for p in upgrade.migration_files(root)], ['001_m1.sql', '002_cloud_auth.sql', '003_project_library.sql', '004_personal_avatars.sql', '005_team_social.sql'])
            (root / 'anything.sql').write_text('SELECT 2;', encoding='utf8')
            with self.assertRaises(ValueError):
                upgrade.migration_files(root)

    def test_shuffled_idless_auth_records_have_stable_identity(self):
        rows = [{'code_hash': 'a', 'metadata': {'x': 1}}, {'code_hash': 'b'}]
        with patch.object(upgrade, 'sql', side_effect=['invitations', __import__('json').dumps(rows)]):
            first = upgrade.snapshot()
        with patch.object(upgrade, 'sql', side_effect=['invitations', __import__('json').dumps(rows[::-1])]):
            second = upgrade.snapshot()
        self.assertEqual(first, second)

    def test_initial_stop_failure_recovers_and_retains_original(self):
        events = []
        original = RuntimeError('secret original')
        def command(args):
            events.append(args[1])
            if len(events) == 1:
                raise original
        with patch.object(upgrade, 'run', side_effect=command), patch.object(upgrade, 'health', return_value={'mode': 'cloud'}), patch.object(upgrade, 'switch'):
            with self.assertRaises(RuntimeError) as caught:
                with upgrade.recovery(pathlib.Path('/unused'), pathlib.Path('/old'), {'mode': 'cloud'}):
                    upgrade.run(['systemctl', 'stop', 'graybox.service'])
        self.assertIs(caught.exception, original)
        self.assertEqual(events, ['stop', 'stop', 'start'])

    def test_guard_runs_before_commit(self):
        with tempfile.TemporaryDirectory() as directory:
            p = pathlib.Path(directory) / '001_fixture.sql'
            p.write_text('SELECT 42;')
            statement = upgrade.migration_transaction([p])
        self.assertLess(statement.index('before_data'), statement.index('SELECT 42'))
        self.assertLess(statement.index('Existing data preservation failed'), statement.index('COMMIT;'))

    def test_each_rollback_failure_still_attempts_later_stages(self):
        for failed in ['stop', 'switch', 'start', 'health']:
            events = []
            original = RuntimeError('original')
            def stage(label):
                events.append(label)
                if label == failed:
                    raise RuntimeError('private details')
            with patch.object(upgrade, 'run', side_effect=lambda args: stage(args[1])), patch.object(upgrade, 'switch', side_effect=lambda *args: stage('switch')), patch.object(upgrade, 'wait_health', side_effect=lambda *args: stage('health')):
                with self.assertRaises(RuntimeError) as caught:
                    with upgrade.recovery(None, None, {}):
                        raise original
            self.assertIs(caught.exception, original)
            self.assertEqual(events, ['stop', 'switch', 'start', 'health'])
            self.assertIn('incomplete', original.__notes__[0])

    @unittest.skipIf(os.name == 'nt', 'fcntl is Linux-only; run on Linux before deployment')
    def test_concurrent_operation_rejected_before_service_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            lock = pathlib.Path(directory) / 'upgrade.lock'
            with upgrade.upgrade_lock(lock):
                with self.assertRaisesRegex(RuntimeError, 'in progress'):
                    with upgrade.upgrade_lock(lock):
                        self.fail('Second operation entered')
            with upgrade.upgrade_lock(lock):
                pass

    def test_duplicate_idless_records_are_not_overwritten(self):
        rows = [{'device_hash': 'same'}, {'device_hash': 'same'}]
        with patch.object(upgrade, 'sql', side_effect=['pairs', __import__('json').dumps(rows)]):
            result = upgrade.snapshot()
        self.assertEqual(sum(result['pairs'].values()), 2)

    def test_successful_rollback_requires_health_verification(self):
        original = RuntimeError('original')
        with patch.object(upgrade, 'run'), patch.object(upgrade, 'switch'), patch.object(upgrade, 'wait_health') as verify:
            with self.assertRaises(RuntimeError):
                with upgrade.recovery(None, None, {'mode': 'cloud'}):
                    raise original
        verify.assert_called_once_with({'mode': 'cloud'})
        self.assertEqual(original.__notes__, ['Graybox rollback: recovered'])


if __name__ == '__main__':
    unittest.main()
