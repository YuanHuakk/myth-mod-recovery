param(
    [Parameter(Mandatory = $true)][string]$RequestPath,
    [Parameter(Mandatory = $true)][string]$ResultPath
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try
{
    if ([IntPtr]::Size -ne 8)
    { throw "Use 64-bit PowerShell with a 64-bit Lua DLL."
    }
    $request = [IO.File]::ReadAllText($RequestPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
    $dll = (Resolve-Path -LiteralPath $request.dll).Path
    $interop = [IO.File]::ReadAllText("$PSScriptRoot/Lua51.cs")
    Add-Type -TypeDefinition $interop.Replace("__LUA_DLL__", $dll.Replace('"', '""'))
    if ($request.mode -eq "compile")
    {
        $errors = @([Lua51Bridge]::Compile([string[]]$request.files))
        $result = [ordered]@{ compiledFiles = $request.files.Count; errors = $errors }
        [IO.File]::WriteAllText($ResultPath, ($result | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
        if ($errors.Count -gt 0)
        { throw ($errors -join "`n")
        }
    } elseif ($request.mode -eq "execute")
    {
        $result = [Lua51Bridge]::Run([IO.File]::ReadAllBytes($request.script))
        [IO.File]::WriteAllText($ResultPath, $result, [Text.UTF8Encoding]::new($false))
    } else
    {
        throw "Unknown bridge mode: $($request.mode)"
    }
} catch
{
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
