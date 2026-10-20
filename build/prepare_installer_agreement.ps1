$ErrorActionPreference = 'Stop'

$licenseFiles = @('LICENSE', 'LICENSE-COMMERCIAL.md', 'NOTICE')
$sections = foreach ($licenseFile in $licenseFiles) {
    $text = Get-Content -Raw -LiteralPath $licenseFile
    $text = $text -replace '(?m)^#{1,6}\s*', ''
    $text = $text -replace '(?m)^- ', '  - '
    $text = $text -replace '\[([^\]]+)\]\(([^)]+)\)', '$1 ($2)'
    $text = $text.Replace(([char]0x00C2).ToString() + ([char]0x00A9).ToString(), '(c)')
    $text = $text.Replace(([char]0x00A9).ToString(), '(c)')
    $text.Trim()
}

$separator = [Environment]::NewLine + [Environment]::NewLine
$encoding = [System.Text.UTF8Encoding]::new($true)
[System.IO.File]::WriteAllText('build\installer-agreement.txt', ($sections -join $separator), $encoding)