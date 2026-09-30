using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using DXWorkbookLauncher;

internal static class Tests
{
    private static int checks;
    private static void Equal<T>(T expected, T actual)
    {
        checks++;
        if (!EqualityComparer<T>.Default.Equals(expected, actual)) throw new Exception("Expected: " + expected + "\nActual: " + actual);
    }
    private static void Reject(Action action, string message = null)
    {
        checks++;
        try { action(); }
        catch (Exception e) { if (message == null || e.Message.Contains(message)) return; throw; }
        throw new Exception("Expected rejection: " + message);
    }
    private static string HTML(params DashboardApp[] apps)
    {
        return "<!doctype html><script id=\"dx-data\" type=\"application/json\">" + LauncherCore.ToJson(new Dashboard { Format = "dx-team-dashboard", SchemaVersion = 1, Apps = apps }) + "</script>";
    }
    private static int Main(string[] args)
    {
        try
        {
            using (JsonDocument vectors = JsonDocument.Parse(File.ReadAllText(args[0])))
            {
                foreach (JsonElement item in vectors.RootElement.EnumerateArray())
                {
                    string id = item.GetProperty("id").GetString();
                    string expected = item.GetProperty("expected").GetString();
                    string request = item.GetProperty("request").GetString();
                    string resolved = LauncherCore.ResolveWorkbookPath(item.GetProperty("path").GetString(), item.GetProperty("dashboard").GetString());
                    Equal(expected, resolved);
                    Equal(request, "dx-workbook://open/v1/" + id + "/" + LauncherCore.Fingerprint(resolved));
                    Settings settings = new Settings { Targets = new[] { new Target { Id = id, Name = "テスト", Path = resolved } }, Executable = @"C:\Program Files\表計算\Calc.exe" };
                    Equal(resolved, LauncherCore.Authorize(request, LauncherCore.FromJson<Settings>(LauncherCore.ToJson(settings))).Path);
                    DashboardApp app = new DashboardApp { Id = id, Name = "テスト", Kind = "excel", Path = item.GetProperty("path").GetString() };
                    Equal(expected, LauncherCore.ImportDashboard(HTML(app), item.GetProperty("dashboard").GetString()).Targets.Single().Path);
                    Reject(() => LauncherCore.Authorize(request + "\n", settings));
                    Reject(() => LauncherCore.Authorize(request + "?file=C:/evil.xlsm", settings));
                    Reject(() => LauncherCore.Authorize(request + "#other", settings));
                    Reject(() => LauncherCore.Authorize(request + "\" --setup", settings));
                    Reject(() => LauncherCore.Authorize(request.Replace("/" + id + "/", "/unknown/"), settings), "未登録");
                    settings.Targets[0].Path = @"C:\changed\another.xlsm";
                    Reject(() => LauncherCore.Authorize(request, settings), "場所が登録時と変わって");
                }
            }
            string[] invalidPaths = { @"C:book.xlsm", @"\book.xlsm", @"\\?\C:\book.xlsm", @"\\.\pipe\book.xlsm", @"\\server\share\..\book.xlsm", @"C:\book.xlsm:stream", @"C:\CON.xlsm", @"C:\folder.\book.xlsm", @"C:\book.xlsm.exe", "C:\\a\n.xlsm", "https://example.com/book.xlsm", "javascript:alert(1)", "ms-excel:ofe|u|https://example.com/book.xlsm", "file://server/share/bad%zz.xlsm" };
            foreach (string path in invalidPaths) Reject(() => LauncherCore.ResolveWorkbookPath(path, @"C:\DX\dashboard.html"));
            Equal("\"C:\\A & B\\100% #.xlsm\"", LauncherCore.QuoteArgument(@"C:\A & B\100% #.xlsm"));
            Reject(() => LauncherCore.QuoteArgument("x\" --setup"));
            Reject(() => LauncherCore.QuoteArgument("x\n"));
            Reject(() => LauncherCore.QuoteArgument("x\\"));
            Reject(() => LauncherCore.Authorize("--setup", null));
            Equal(false, LauncherCore.ValidId("app\n"));
            DashboardApp valid = new DashboardApp { Id = "valid", Name = "登録対象", Kind = "excel", Path = @".\apps\book.xlsm" };
            ImportResult mixed = LauncherCore.ImportDashboard(HTML(valid,
                new DashboardApp { Id = "web", Kind = "html", Path = "./app.html" },
                new DashboardApp { Id = "pending", Kind = "excel", Path = "" },
                new DashboardApp { Id = "wrong", Kind = "excel", Path = "./runtime/index.html" }), @"C:\DX\dashboard.html");
            Equal(1, mixed.Targets.Count); Equal(1, mixed.Skipped.Count);
            Reject(() => LauncherCore.ImportDashboard(HTML(valid, valid), @"C:\DX\dashboard.html"), "重複");
            Reject(() => LauncherCore.ImportDashboard("<h1>unrelated</h1>", @"C:\DX\dashboard.html"));
            Reject(() => LauncherCore.ImportDashboard(HTML(valid).Replace("dx-team-dashboard", "other"), @"C:\DX\dashboard.html"));
            Reject(() => LauncherCore.ValidateSettings(new Settings { Targets = new[] { new Target { Id = "x", Path = "./book.xlsm" } } }));
            Reject(() => LauncherCore.ValidateSettings(new Settings { Version = 99, Targets = new Target[0] }));
            ImportResult exported = LauncherCore.ImportDashboard(File.ReadAllText(args[1]), @"\\server\share\DXダッシュボード.html");
            Equal(@"\\server\share\アプリ\引継ぎ #1%.xlsm", exported.Targets.Single().Path);
            Equal("引継ぎ <確認> & 日本語", exported.Targets.Single().Name);
            Console.WriteLine("Launcher core: " + checks + " assertions passed (URI authorization, browser interoperability, Windows paths, stale registrations, JSON import). Windows UI/process/registry execution is not covered here.");
            return 0;
        }
        catch (Exception e) { Console.Error.WriteLine(e); return 1; }
    }
}
