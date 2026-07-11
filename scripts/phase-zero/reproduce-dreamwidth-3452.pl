#!/usr/bin/env perl

use strict;
use warnings;

use JSON::PP;
use Template;

my ( $template_path, $expected_outcome ) = @ARGV;
die "usage: $0 TEMPLATE_PATH defect|fixed\n"
    unless $template_path && $expected_outcome && $expected_outcome =~ /\A(?:defect|fixed)\z/;

{
    package Roundhouse::MockUser;

    sub new            { return bless {}, shift }
    sub gift_url       { return 'https://example.test/shop/randomgift' }
    sub ljuser_display { return 'example-user' }
}

{
    package Roundhouse::MockDW;

    sub new { return bless {}, shift }
    sub ml  { return $_[1] }
}

my $template = Template->new( ABSOLUTE => 1 );
my $output   = '';
my $vars     = {
    bdays       => [ [ '01', '02', 1 ] ],
    load_user   => sub { return Roundhouse::MockUser->new },
    month_short => sub { return 'Jan' },
    site        => { root => 'https://example.test' },
    dw          => Roundhouse::MockDW->new,
};

$template->process( $template_path, $vars, \$output )
    or die $template->error;

my ($observed_href) = $output =~ m{<a href='([^']*)' class='gift-link'>};
die "rendered output did not contain the gift link\n" unless defined $observed_href;

my $expected_href = 'https://example.test/shop/randomgift';
my $defect_seen   = $observed_href ne $expected_href;
my $matched       = $expected_outcome eq 'defect' ? $defect_seen : !$defect_seen;

print JSON::PP->new->canonical->encode(
    {
        expected_href    => $expected_href,
        expected_outcome => $expected_outcome,
        matched          => $matched ? JSON::PP::true : JSON::PP::false,
        observed_href    => $observed_href,
    }
), "\n";

exit( $matched ? 0 : 1 );
