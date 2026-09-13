import 'package:flutter/material.dart';

void main() {
  runApp(const ChurchPlatformApp());
}

class ChurchPlatformApp extends StatelessWidget {
  const ChurchPlatformApp({super.key});

  @override
  Widget build(BuildContext context) {
    const brandColor = Color(0xFF286749);

    return MaterialApp(
      title: 'Church Platform',
      themeMode: ThemeMode.system,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: brandColor),
        useMaterial3: true,
      ),
      darkTheme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF99D5B2),
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
      ),
      home: const PlatformShell(),
    );
  }
}

class PlatformShell extends StatelessWidget {
  const PlatformShell({super.key});

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    final colorScheme = Theme.of(context).colorScheme;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 520),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(32),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'IN DEVELOPMENT',
                        style: textTheme.labelLarge?.copyWith(
                          color: colorScheme.primary,
                          letterSpacing: 1.2,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 20),
                      Text(
                        'Church Platform',
                        style: textTheme.headlineLarge?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 16),
                      Text(
                        'A thoughtful mobile home for church life and community.',
                        style: textTheme.titleLarge,
                      ),
                      const SizedBox(height: 12),
                      Text(
                        'The foundations are taking shape. More will be available here as development continues.',
                        style: textTheme.bodyLarge,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
