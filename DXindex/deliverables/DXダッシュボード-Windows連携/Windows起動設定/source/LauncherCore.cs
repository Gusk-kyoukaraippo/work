using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace DXWorkbookLauncher
{
    [DataContract]
    public sealed class Dashboard
    {
        [DataMember(Name = "format")] public string Format;
        [DataMember(Name = "schemaVersion")] public int SchemaVersion;
        [DataMember(Name = "apps")] public DashboardApp[] Apps;
    }
    [DataContract]
    public sealed class DashboardApp
    {
        [DataMember(Name = "id")] public string Id;
        [DataMember(Name = "name")] public string Name;
        [DataMember(Name = "kind")] public string Kind;
        [DataMember(Name = "path")] public string Path;
    }
    [DataContract]
    public sealed class Target
    {
        [DataMember] public string Id;
        [DataMember] public string Name;
        [DataMember] public string Path;
    }
    [DataContract]
    public sealed class Settings
    {
        [DataMember] public int Version = 1;
        [DataMember] public string DashboardPath;
        [DataMember] public string Executable;
        [DataMember] public Target[] Targets;
    }
    public sealed class ImportResult
    {
        public readonly List<Target> Targets = new List<Target>();
        public readonly List<string> Skipped = new List<string>();
    }
    public static class LauncherCore
    {
        public const string Scheme = "dx-workbook";
        public static bool ValidId(string id) { return id != null && Regex.IsMatch(id, @"\A[A-Za-z0-9_-]{1,80}\z"); }
        public static string CleanPath(string value)
        {
            if (value == null) throw new InvalidDataException("ブックの場所がありません。");
            string path = value.Trim();
            if (path.StartsWith("\"") && path.EndsWith("\"") && path.Length >= 2) path = path.Substring(1, path.Length - 2).Trim();
            if (path.Length == 0 || path.Length > 2000 || Regex.IsMatch(path, "[\x00-\x1f\x7f\"]"))
                throw new InvalidDataException("ブックの場所を確認してください。");
            return path;
        }
        // Windows path rules are applied on every platform, including the cross-platform tests.
        public static string NormalizeWindowsPath(string value)
        {
            string path = CleanPath(value).Replace('/', '\\');
            string root;
            string[] parts;
            if (Regex.IsMatch(path, @"\A[A-Za-z]:\\"))
            {
                root = path.Substring(0, 2);
                parts = path.Substring(3).Split('\\');
            }
            else if (path.StartsWith(@"\\"))
            {
                string[] unc = path.Substring(2).Split('\\');
                if (unc.Length < 3 || !ValidSegment(unc[0]) || !ValidSegment(unc[1])) throw new InvalidDataException("共有ブックのフルパスを確認してください。");
                root = @"\\" + unc[0] + "\\" + unc[1];
                parts = unc.Skip(2).ToArray();
            }
            else throw new InvalidDataException("Windowsのドライブパスまたは共有パスが必要です。");
            List<string> normalized = new List<string>();
            foreach (string part in parts)
            {
                if (part == "" || part == ".") continue;
                if (part == "..")
                {
                    if (normalized.Count == 0) throw new InvalidDataException("共有フォルダまたはドライブの外を指しています。");
                    normalized.RemoveAt(normalized.Count - 1);
                }
                else
                {
                    if (!ValidSegment(part)) throw new InvalidDataException("Windowsで使えないファイル名です。");
                    normalized.Add(part);
                }
            }
            if (normalized.Count == 0) throw new InvalidDataException("ブックのファイル名が必要です。");
            return root + "\\" + String.Join("\\", normalized.ToArray());
        }
        private static bool ValidSegment(string part)
        {
            return part.Length > 0 && part != "." && part != ".." && !Regex.IsMatch(part, "[<>:\"|?*\x00-\x1f\x7f]")
                && !part.EndsWith(".") && !part.EndsWith(" ")
                && !Regex.IsMatch(part, @"\A(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|\z)", RegexOptions.IgnoreCase);
        }
        public static string ResolveWorkbookPath(string value, string dashboardPath)
        {
            string path = CleanPath(value).Replace('\\', '/');
            if (path.StartsWith("file:", StringComparison.OrdinalIgnoreCase))
            {
                Match uri = Regex.Match(path, @"\Afile://([^/]*)(/.*)\z", RegexOptions.IgnoreCase);
                if (!uri.Success || Regex.IsMatch(uri.Groups[1].Value, @"[\s?#:@]") || Regex.IsMatch(uri.Groups[2].Value, @"%(?![0-9a-fA-F]{2})"))
                    throw new InvalidDataException("file URLを確認してください。");
                string host = uri.Groups[1].Value;
                string tail = Uri.UnescapeDataString(uri.Groups[2].Value);
                path = host.Length > 0 && !host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
                    ? "//" + host.ToLowerInvariant() + tail : Regex.IsMatch(tail, @"\A/[A-Za-z]:/") ? tail.Substring(1) : tail;
            }
            else if (!Regex.IsMatch(path, @"\A[A-Za-z]:/") && !path.StartsWith("//"))
            {
                if (path.StartsWith("/") || path.Contains(":")) throw new InvalidDataException("Web URLは元ブックの場所として登録できません。");
                string dashboard = NormalizeWindowsPath(dashboardPath);
                path = dashboard.Substring(0, dashboard.LastIndexOf('\\') + 1) + path;
            }
            path = NormalizeWindowsPath(path);
            if (!Regex.IsMatch(path, @"\.(xls|xlsx|xlsm|xlsb|xlt|xltx|xltm)\z", RegexOptions.IgnoreCase))
                throw new InvalidDataException("アプリ名.xlsmなど、ブックのファイルを指定してください。");
            return path;
        }
        public static string Fingerprint(string path)
        {
            string normalized = Regex.Replace(NormalizeWindowsPath(path), "[A-Z]", m => m.Value.ToLowerInvariant());
            using (SHA256 sha = SHA256.Create())
                return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(normalized))).Replace("-", "").ToLowerInvariant();
        }
        public static Target Authorize(string request, Settings settings)
        {
            Match match = Regex.Match(request ?? "", @"\Adx-workbook://open/v1/([A-Za-z0-9_-]{1,80})/([a-f0-9]{64})\z");
            if (!match.Success) throw new InvalidDataException("起動リンクが正しくありません。ダッシュボードのボタンから開いてください。");
            ValidateSettings(settings);
            Target target = settings.Targets.FirstOrDefault(t => t.Id == match.Groups[1].Value);
            if (target == null) throw new InvalidDataException("このアプリはこのPCに未登録です。初回設定で、共有先の最新ダッシュボードを読み直してください。");
            if (Fingerprint(target.Path) != match.Groups[2].Value)
                throw new InvalidDataException("ブックの場所が登録時と変わっています。初回設定で最新ダッシュボードを読み直してください。以前のブックは開きません。");
            return target;
        }
        public static void ValidateSettings(Settings settings)
        {
            if (settings == null || settings.Version != 1 || settings.Targets == null || settings.Targets.Length > 1000)
                throw new InvalidDataException("このPCの登録情報を読み込めません。初回設定を行ってください。");
            HashSet<string> ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (Target target in settings.Targets)
            {
                if (target == null || !ValidId(target.Id) || !ids.Add(target.Id)) throw new InvalidDataException("登録情報のアプリIDが不正または重複しています。");
                if (ResolveWorkbookPath(target.Path, target.Path) != target.Path) throw new InvalidDataException("登録済みの場所がフルパスではありません。");
            }
            if (!String.IsNullOrEmpty(settings.Executable))
            {
                if (NormalizeWindowsPath(settings.Executable) != settings.Executable || !settings.Executable.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("起動する表計算ソフトの場所が正しくありません。");
            }
        }
        public static ImportResult ImportDashboard(string html, string dashboardPath)
        {
            const string marker = "<script id=\"dx-data\" type=\"application/json\">";
            int start = html.IndexOf(marker, StringComparison.Ordinal);
            int end = start < 0 ? -1 : html.IndexOf("</script>", start + marker.Length, StringComparison.Ordinal);
            if (start < 0 || end < 0) throw new InvalidDataException("DXダッシュボードのHTMLを選んでください。");
            string json = html.Substring(start + marker.Length, end - start - marker.Length);
            if (Encoding.UTF8.GetByteCount(json) > 10 * 1024 * 1024) throw new InvalidDataException("登録データが10MiBを超えています。");
            Dashboard dashboard = FromJson<Dashboard>(json);
            if (dashboard == null || dashboard.Format != "dx-team-dashboard" || dashboard.SchemaVersion != 1 || dashboard.Apps == null || dashboard.Apps.Length > 1000)
                throw new InvalidDataException("この版のDXダッシュボードではありません。");
            HashSet<string> ids = new HashSet<string>(StringComparer.Ordinal);
            ImportResult result = new ImportResult();
            foreach (DashboardApp app in dashboard.Apps)
            {
                if (app == null || !ValidId(app.Id) || !ids.Add(app.Id)) throw new InvalidDataException("ダッシュボードのアプリIDが不正または重複しています。");
                if (app.Kind != "excel") continue;
                if (String.IsNullOrWhiteSpace(app.Path)) continue;
                try { result.Targets.Add(new Target { Id = app.Id, Name = app.Name, Path = ResolveWorkbookPath(app.Path, dashboardPath) }); }
                catch (InvalidDataException e) { result.Skipped.Add(app.Name + "：" + e.Message); }
            }
            return result;
        }
        public static T FromJson<T>(string json)
        {
            using (MemoryStream stream = new MemoryStream(Encoding.UTF8.GetBytes(json)))
                return (T)new DataContractJsonSerializer(typeof(T)).ReadObject(stream);
        }
        public static string ToJson<T>(T value)
        {
            using (MemoryStream stream = new MemoryStream())
            {
                new DataContractJsonSerializer(typeof(T)).WriteObject(stream, value);
                return Encoding.UTF8.GetString(stream.ToArray());
            }
        }
        public static string QuoteArgument(string value)
        {
            if (String.IsNullOrEmpty(value) || value.Contains("\"") || Regex.IsMatch(value, "[\x00-\x1f\x7f]") || value.EndsWith("\\"))
                throw new InvalidDataException("起動するファイルの引数が正しくありません。");
            return "\"" + value + "\"";
        }
    }
}
