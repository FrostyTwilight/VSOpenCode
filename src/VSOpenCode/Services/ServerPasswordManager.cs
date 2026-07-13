using System;
using System.Security.Cryptography;

namespace VSOpenCode.Services
{
    /// <summary>
    /// Generates a random password for OpenCode server authentication.
    /// New password each server start.
    /// </summary>
    internal static class ServerPasswordManager
    {
        public static string GeneratePassword()
        {
            var bytes = new byte[24];
            using (var rng = RandomNumberGenerator.Create())
            {
                rng.GetBytes(bytes);
            }
            return Convert.ToBase64String(bytes)
                .Replace('+', 'x')
                .Replace('/', 'y')
                .Replace('=', 'z');
        }
    }
}
