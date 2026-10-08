import importlib.util
import os
import pathlib
import tempfile
import unittest

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
            for name in ['003_project_library.sql', '001_m1.sql', '002_cloud_auth.sql']:
                (root / name).write_text('SELECT 1;', encoding='utf8')
            self.assertEqual([p.name for p in upgrade.migration_files(root)], ['001_m1.sql', '002_cloud_auth.sql', '003_project_library.sql'])
            (root / 'anything.sql').write_text('SELECT 2;', encoding='utf8')
            with self.assertRaises(ValueError):
                upgrade.migration_files(root)


if __name__ == '__main__':
    unittest.main()
