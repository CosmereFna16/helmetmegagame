import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    async jwt({ token, profile }) {
      if (profile?.id) {
        token.discordUserId = profile.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.discordUserId) {
        session.discordUserId = token.discordUserId;
      }
      return session;
    },
  },
});
