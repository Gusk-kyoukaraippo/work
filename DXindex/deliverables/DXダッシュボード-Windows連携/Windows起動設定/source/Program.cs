using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

namespace DXWorkbookLauncher
{
    internal static class Program
    {
        internal const string Product = "DXブック起動設定";
        internal static readonly string InstallDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DXWorkbookLauncher");
        internal static readonly string InstalledExe = Path.Combine(InstallDirectory, "DXWorkbookLauncher.exe");
        internal static readonly string SettingsFile = Path.Combine(InstallDirectory, "settings.json");
        private const string ProtocolKey = @"Software\Classes\dx-workbook";

        [STAThread]
        private static int Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try
            {
                if (args.Length == 0 || (args.Length == 1 && args[0] == "--setup"))
                {
                    Application.Run(new SetupForm());
                    return 0;
                }
                if (args.Length == 1 && args[0] == "--uninstall") { Uninstall(); return 0; }
                if (args.Length != 1) throw new InvalidDataException("起動リンクの引数が正しくありません。");
                Settings settings = ReadSettings();
                Target target = LauncherCore.Authorize(args[0], settings);
                if (!File.Exists(target.Path)) throw new FileNotFoundException("共有ブックが見つからないか、アクセスできません。共有フォルダへの接続と場所を確認してください。\n\n" + target.Path);
                ProcessStartInfo start;
                if (String.IsNullOrEmpty(settings.Executable))
                {
                    start = new ProcessStartInfo { FileName = target.Path, UseShellExecute = true, Verb = "open" };
                }
                else
                {
                    if (!File.Exists(settings.Executable)) throw new FileNotFoundException("指定した表計算ソフトが見つかりません。初回設定で選び直してください。\n\n" + settings.Executable);
                    start = new ProcessStartInfo { FileName = settings.Executable, Arguments = LauncherCore.QuoteArgument(target.Path), UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(settings.Executable) };
                }
                using (Process process = Process.Start(start)) { }
                return 0;
            }
            catch (Exception e)
            {
                MessageBox.Show(e.Message, Product, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return 1;
            }
        }
        internal static Settings ReadSettings()
        {
            if (!File.Exists(SettingsFile)) throw new InvalidDataException("このPCの初回設定がまだ済んでいません。配布一式の「初回設定.cmd」を実行してください。");
            if (new FileInfo(SettingsFile).Length > 4 * 1024 * 1024) throw new InvalidDataException("登録情報が大きすぎます。初回設定で登録し直してください。");
            Settings settings = LauncherCore.FromJson<Settings>(File.ReadAllText(SettingsFile, Encoding.UTF8));
            LauncherCore.ValidateSettings(settings);
            return settings;
        }
        private static void CheckProtocolOwner()
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(ProtocolKey))
            {
                if (key != null && (string)key.GetValue("DXOwner") != "DXWorkbookLauncher")
                    throw new InvalidOperationException("同じ起動リンクが別のプログラムに登録されています。現在の登録を変更せず停止しました。管理担当者へ確認してください。");
            }
        }
        internal static void Install(Settings settings)
        {
            LauncherCore.ValidateSettings(settings);
            if (settings.Targets.Length == 0) throw new InvalidDataException("登録するブックを一つ以上選んでください。");
            CheckProtocolOwner();
            Directory.CreateDirectory(InstallDirectory);
            string source = Application.ExecutablePath;
            if (!String.Equals(Path.GetFullPath(source), InstalledExe, StringComparison.OrdinalIgnoreCase))
            {
                File.Copy(source, InstalledExe, true);
                if (File.Exists(source + ".config")) File.Copy(source + ".config", InstalledExe + ".config", true);
            }
            string pending = Path.Combine(InstallDirectory, "settings-" + Guid.NewGuid().ToString("N") + ".tmp");
            try
            {
                File.WriteAllText(pending, LauncherCore.ToJson(settings), new UTF8Encoding(false));
                if (File.Exists(SettingsFile)) File.Replace(pending, SettingsFile, null);
                else File.Move(pending, SettingsFile);
            }
            finally { if (File.Exists(pending)) File.Delete(pending); }
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(ProtocolKey))
            {
                key.SetValue("", "URL:DX Workbook Launcher");
                key.SetValue("URL Protocol", "");
                key.SetValue("DXOwner", "DXWorkbookLauncher");
                using (RegistryKey command = key.CreateSubKey(@"shell\open\command"))
                    command.SetValue("", LauncherCore.QuoteArgument(InstalledExe) + " \"%1\"");
            }
        }
        private static void Uninstall()
        {
            CheckProtocolOwner();
            if (MessageBox.Show("このWindowsユーザーのブック起動設定を解除します。共有ブックとダッシュボードは変更しません。", Product, MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK) return;
            Registry.CurrentUser.DeleteSubKeyTree(ProtocolKey, false);
            if (File.Exists(SettingsFile)) File.Delete(SettingsFile);
            MessageBox.Show("登録を解除しました。起動プログラム本体は終了後に次のフォルダごと削除できます。\n\n" + InstallDirectory, Product);
        }
    }

    internal sealed class SetupForm : Form
    {
        private readonly TextBox dashboard = new TextBox { ReadOnly = true, Dock = DockStyle.Fill };
        private readonly TextBox executable = new TextBox { ReadOnly = true, Dock = DockStyle.Fill };
        private readonly RadioButton associated = new RadioButton { Text = "Windowsで設定されている表計算ソフトを使う", AutoSize = true, Checked = true };
        private readonly RadioButton specified = new RadioButton { Text = "JUST Calc／Excelを指定する", AutoSize = true };
        private readonly ListView targets = new ListView { Dock = DockStyle.Fill, View = View.Details, CheckBoxes = true, FullRowSelect = true, HideSelection = false };
        private readonly Label status = new Label { AutoSize = true, Dock = DockStyle.Fill };
        private readonly TextBox skipped = new TextBox { ReadOnly = true, Multiline = true, ScrollBars = ScrollBars.Vertical, Dock = DockStyle.Fill, Height = 60 };
        private readonly Button save = new Button { Text = "このPCに登録", AutoSize = true, Enabled = false };
        private ImportResult imported;
        private string loadedPath;

        internal SetupForm()
        {
            Text = Program.Product;
            Font = new Font("Yu Gothic UI", 10);
            ClientSize = new Size(960, 720);
            MinimumSize = new Size(800, 620);
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi;
            TableLayoutPanel layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(22), ColumnCount = 1, RowCount = 9 };
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 68));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 62));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 72));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 30));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 68));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 35));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 50));
            Controls.Add(layout);
            layout.Controls.Add(new Label { Text = "ダッシュボードのボタンから、元の場所のブックを開く設定です。\n共有先に配置した、アプリ登録済みのDXダッシュボード.htmlを選んでください。", Dock = DockStyle.Fill, AutoSize = true }, 0, 0);
            layout.Controls.Add(FileRow("ダッシュボード", dashboard, "HTMLを選ぶ", BrowseDashboard), 0, 1);
            layout.Controls.Add(new Label { Text = "ExcelゲートはJUST Calcが開く設定にします。別のソフトが開く場合は下で指定してください。", Dock = DockStyle.Fill, AutoSize = true }, 0, 2);
            TableLayoutPanel software = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2 };
            FlowLayoutPanel radios = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true };
            radios.Controls.Add(associated); radios.Controls.Add(specified);
            software.Controls.Add(radios, 0, 0);
            software.Controls.Add(FileRow("指定ソフト", executable, "ソフトを選ぶ", BrowseExecutable), 0, 1);
            layout.Controls.Add(software, 0, 3);
            layout.Controls.Add(new Label { Text = "ボタンから開けるようにするブック（チェックしたものを登録します）", Dock = DockStyle.Fill, AutoSize = true }, 0, 4);
            targets.Columns.Add("アプリ名", 240); targets.Columns.Add("共有元のブック", 615);
            layout.Controls.Add(targets, 0, 5);
            layout.Controls.Add(skipped, 0, 6);
            layout.Controls.Add(status, 0, 7);
            FlowLayoutPanel actions = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft };
            Button close = new Button { Text = "閉じる", AutoSize = true };
            close.Click += delegate { Close(); };
            save.Click += Save;
            actions.Controls.Add(close); actions.Controls.Add(save);
            layout.Controls.Add(actions, 0, 8);
            Shown += delegate { LoadInitial(); };
        }
        private static Control FileRow(string caption, TextBox box, string label, EventHandler click)
        {
            TableLayoutPanel row = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, AutoSize = true };
            row.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 130));
            row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            row.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 125));
            row.Controls.Add(new Label { Text = caption, AutoSize = true, Anchor = AnchorStyles.Left }, 0, 0);
            row.Controls.Add(box, 1, 0);
            Button browse = new Button { Text = label, Dock = DockStyle.Top, AutoSize = true };
            browse.Click += click; row.Controls.Add(browse, 2, 0);
            return row;
        }
        private void LoadInitial()
        {
            try
            {
                if (File.Exists(Program.SettingsFile))
                {
                    Settings settings = Program.ReadSettings();
                    executable.Text = settings.Executable ?? "";
                    specified.Checked = !String.IsNullOrEmpty(settings.Executable);
                    if (File.Exists(settings.DashboardPath)) { Import(settings.DashboardPath); return; }
                    status.Text = "前回のHTMLが見つかりません。共有先のダッシュボードを選んでください。";
                }
                string bundled = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "DXダッシュボード.html"));
                if (File.Exists(bundled)) Import(bundled);
            }
            catch (Exception e) { status.Text = e.Message; }
        }
        private void BrowseDashboard(object sender, EventArgs args)
        {
            using (OpenFileDialog dialog = new OpenFileDialog { Title = "配置済みのDXダッシュボードを選ぶ", Filter = "HTMLファイル|*.html;*.htm", CheckFileExists = true })
                if (dialog.ShowDialog(this) == DialogResult.OK) Import(dialog.FileName);
        }
        private void Import(string file)
        {
            imported = null; loadedPath = null; save.Enabled = false; targets.Items.Clear(); skipped.Clear();
            dashboard.Text = file;
            try
            {
                if (new FileInfo(file).Length > 32 * 1024 * 1024) throw new InvalidDataException("HTMLが32MiBを超えています。");
                string fullPath = Path.GetFullPath(file);
                imported = LauncherCore.ImportDashboard(File.ReadAllText(fullPath, Encoding.UTF8), fullPath);
                foreach (Target target in imported.Targets)
                {
                    ListViewItem item = new ListViewItem(target.Name ?? target.Id) { Checked = true, Tag = target };
                    item.SubItems.Add(target.Path); targets.Items.Add(item);
                }
                loadedPath = fullPath;
                skipped.Text = imported.Skipped.Count > 0 ? "登録できない項目：\r\n" + String.Join("\r\n", imported.Skipped.ToArray()) : "HTMLアプリとリンク未登録のアプリは対象外です。ブックの追加・場所の変更後は、この設定を更新します。";
                status.Text = imported.Targets.Count == 0 ? "登録できるブックがありません。ダッシュボードにブックを登録し、更新HTMLを共有先に配置してください。" : imported.Targets.Count + "件のブックを読み込みました。場所と起動するソフトを確認して登録してください。";
                save.Enabled = imported.Targets.Count > 0;
            }
            catch (Exception e) { status.Text = e.Message; }
        }
        private void BrowseExecutable(object sender, EventArgs args)
        {
            using (OpenFileDialog dialog = new OpenFileDialog { Title = "JUST CalcまたはExcelの実行ファイルを選ぶ", Filter = "実行ファイル|*.exe", InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), CheckFileExists = true })
                if (dialog.ShowDialog(this) == DialogResult.OK) { executable.Text = dialog.FileName; specified.Checked = true; }
        }
        private void Save(object sender, EventArgs args)
        {
            try
            {
                if (imported == null || loadedPath == null) throw new InvalidOperationException("先にダッシュボードを選んでください。");
                string exe = specified.Checked ? executable.Text : "";
                if (specified.Checked && !File.Exists(exe)) throw new FileNotFoundException("起動する表計算ソフトを選んでください。");
                Settings settings = new Settings { DashboardPath = loadedPath, Executable = exe, Targets = targets.CheckedItems.Cast<ListViewItem>().Select(item => (Target)item.Tag).ToArray() };
                Program.Install(settings);
                MessageBox.Show(this, "登録しました。DXダッシュボードをEdgeで開き直し、「ブックを開く」を押してください。\n\nEdgeからアプリ起動の確認が出た場合は、表示された内容を確認して開きます。", Program.Product);
                Close();
            }
            catch (Exception e) { MessageBox.Show(this, e.Message, Program.Product, MessageBoxButtons.OK, MessageBoxIcon.Warning); }
        }
    }
}
